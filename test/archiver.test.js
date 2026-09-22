const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { combine } = require('./helpers');
const { fixture } = require('./fixtures');

describe('Archiver', function () {
  const IFACE = {
    IEventArchive: '0x9d72cee3',
    IEventArchiveWriter: '0x95499796',
    IERC165: '0x01ffc9a7',
  };

  beforeEach(async function () {
    await loadFixture(fixture).then((results) => Object.assign(this, results));

    this.makeArchiveOp = (overrides = {}) => ({
      sourceChainId: overrides.sourceChainId ?? 1,
      sourceTxHash: overrides.sourceTxHash ?? ethers.hexlify(ethers.randomBytes(32)),
      sourceAddress: overrides.sourceAddress ?? ethers.getAddress(ethers.hexlify(ethers.randomBytes(20))),
      sourceLogIndex: overrides.sourceLogIndex ?? 0,
      sourceBlockNumber: overrides.sourceBlockNumber ?? 123456,
      payload: overrides.payload ?? ethers.hexlify(ethers.randomBytes(64)),
    });

    this.archive = (op, signer = this.accounts.archiver) =>
      this.contracts.archiver
        .connect(signer)
        .archiveEvent(
          op.sourceChainId,
          op.sourceTxHash,
          op.sourceAddress,
          op.sourceLogIndex,
          op.sourceBlockNumber,
          op.payload
        );
  });

  it('functions have requirements', async function () {
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.archiver,
        this.contracts.archiver.interface.getFunction('upgradeToAndCall').selector
      )
    ).to.equal(combine(this.MASKS.admin));
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.archiver,
        this.contracts.archiver.interface.getFunction('archiveEvent').selector
      )
    ).to.equal(combine(this.MASKS.admin, this.MASKS.archiver));
  });

  describe('archiveEvent', function () {
    it('success - authorized archiver', async function () {
      const op = this.makeArchiveOp();

      await expect(this.contracts.archiver.isArchived(op.sourceChainId, op.sourceTxHash, op.sourceLogIndex)).to
        .eventually.be.false;
      await expect(
        this.contracts.archiver.latestVersion(op.sourceChainId, op.sourceTxHash, op.sourceLogIndex)
      ).to.eventually.equal(0);

      await expect(this.archive(op))
        .to.emit(this.contracts.archiver, 'EventArchived')
        .withArgs(
          op.sourceChainId,
          op.sourceTxHash,
          op.sourceAddress,
          op.sourceLogIndex,
          op.sourceBlockNumber,
          1,
          op.payload
        );

      await expect(this.contracts.archiver.isArchived(op.sourceChainId, op.sourceTxHash, op.sourceLogIndex)).to
        .eventually.be.true;
      await expect(
        this.contracts.archiver.latestVersion(op.sourceChainId, op.sourceTxHash, op.sourceLogIndex)
      ).to.eventually.equal(1);
    });

    it('success - empty payload allowed', async function () {
      const op = this.makeArchiveOp({ payload: '0x' });

      await expect(this.archive(op))
        .to.emit(this.contracts.archiver, 'EventArchived')
        .withArgs(
          op.sourceChainId,
          op.sourceTxHash,
          op.sourceAddress,
          op.sourceLogIndex,
          op.sourceBlockNumber,
          1,
          '0x'
        );
    });

    it('success - admin can archive', async function () {
      const op = this.makeArchiveOp();
      await expect(this.archive(op, this.accounts.admin)).to.emit(this.contracts.archiver, 'EventArchived');
    });

    it('success - re-archiving same eventId increments version (amendment)', async function () {
      const op = this.makeArchiveOp();
      await this.archive(op);

      const payload1 = ethers.hexlify(ethers.randomBytes(32));
      const amendment1 = this.makeArchiveOp({
        sourceChainId: op.sourceChainId,
        sourceTxHash: op.sourceTxHash,
        sourceLogIndex: op.sourceLogIndex,
        sourceAddress: op.sourceAddress,
        sourceBlockNumber: op.sourceBlockNumber,
        payload: payload1,
      });
      await expect(this.archive(amendment1))
        .to.emit(this.contracts.archiver, 'EventArchived')
        .withArgs(
          op.sourceChainId,
          op.sourceTxHash,
          op.sourceAddress,
          op.sourceLogIndex,
          op.sourceBlockNumber,
          2,
          payload1
        );
      await expect(
        this.contracts.archiver.latestVersion(op.sourceChainId, op.sourceTxHash, op.sourceLogIndex)
      ).to.eventually.equal(2);

      const payload2 = ethers.hexlify(ethers.randomBytes(16));
      const amendment2 = { ...amendment1, payload: payload2 };
      await expect(this.archive(amendment2))
        .to.emit(this.contracts.archiver, 'EventArchived')
        .withArgs(
          op.sourceChainId,
          op.sourceTxHash,
          op.sourceAddress,
          op.sourceLogIndex,
          op.sourceBlockNumber,
          3,
          payload2
        );
      await expect(
        this.contracts.archiver.latestVersion(op.sourceChainId, op.sourceTxHash, op.sourceLogIndex)
      ).to.eventually.equal(3);
    });

    it('success - different sourceChainId is a distinct eventId', async function () {
      const base = this.makeArchiveOp({ sourceChainId: 1 });
      const other = { ...base, sourceChainId: 10 };

      await this.archive(base);
      await expect(this.archive(other))
        .to.emit(this.contracts.archiver, 'EventArchived')
        .withArgs(
          10,
          base.sourceTxHash,
          base.sourceAddress,
          base.sourceLogIndex,
          base.sourceBlockNumber,
          1,
          base.payload
        );

      await expect(
        this.contracts.archiver.latestVersion(1, base.sourceTxHash, base.sourceLogIndex)
      ).to.eventually.equal(1);
      await expect(
        this.contracts.archiver.latestVersion(10, base.sourceTxHash, base.sourceLogIndex)
      ).to.eventually.equal(1);
    });

    it('success - different sourceLogIndex is a distinct eventId', async function () {
      const base = this.makeArchiveOp({ sourceLogIndex: 0 });
      const other = { ...base, sourceLogIndex: 1 };

      await this.archive(base);
      await this.archive(other);

      await expect(this.contracts.archiver.latestVersion(base.sourceChainId, base.sourceTxHash, 0)).to.eventually.equal(
        1
      );
      await expect(this.contracts.archiver.latestVersion(base.sourceChainId, base.sourceTxHash, 1)).to.eventually.equal(
        1
      );
    });

    it('success - different sourceTxHash is a distinct eventId', async function () {
      const base = this.makeArchiveOp();
      const other = { ...base, sourceTxHash: ethers.hexlify(ethers.randomBytes(32)) };

      await this.archive(base);
      await this.archive(other);

      await expect(
        this.contracts.archiver.latestVersion(base.sourceChainId, base.sourceTxHash, base.sourceLogIndex)
      ).to.eventually.equal(1);
      await expect(
        this.contracts.archiver.latestVersion(base.sourceChainId, other.sourceTxHash, base.sourceLogIndex)
      ).to.eventually.equal(1);
    });

    it('success - sourceAddress and sourceBlockNumber are outside the eventId', async function () {
      const base = this.makeArchiveOp();
      await this.archive(base);

      // Same (sourceChainId, sourceTxHash, sourceLogIndex) with a different address and block: this
      // is an amendment of the existing record, not a new one.
      const amendment = {
        ...base,
        sourceAddress: ethers.getAddress(ethers.hexlify(ethers.randomBytes(20))),
        sourceBlockNumber: base.sourceBlockNumber + 1,
        payload: ethers.hexlify(ethers.randomBytes(8)),
      };

      await expect(this.archive(amendment))
        .to.emit(this.contracts.archiver, 'EventArchived')
        .withArgs(
          base.sourceChainId,
          base.sourceTxHash,
          amendment.sourceAddress,
          base.sourceLogIndex,
          amendment.sourceBlockNumber,
          2,
          amendment.payload
        );

      await expect(
        this.contracts.archiver.latestVersion(base.sourceChainId, base.sourceTxHash, base.sourceLogIndex)
      ).to.eventually.equal(2);
    });

    it('success - empty payload amendment bumps version', async function () {
      const op = this.makeArchiveOp();
      await this.archive(op);

      await expect(this.archive({ ...op, payload: '0x' }))
        .to.emit(this.contracts.archiver, 'EventArchived')
        .withArgs(
          op.sourceChainId,
          op.sourceTxHash,
          op.sourceAddress,
          op.sourceLogIndex,
          op.sourceBlockNumber,
          2,
          '0x'
        );

      await expect(
        this.contracts.archiver.latestVersion(op.sourceChainId, op.sourceTxHash, op.sourceLogIndex)
      ).to.eventually.equal(2);
    });

    it('success - zero sourceTxHash accepted', async function () {
      const op = this.makeArchiveOp({ sourceTxHash: ethers.ZeroHash });

      await expect(this.archive(op)).to.emit(this.contracts.archiver, 'EventArchived');
      await expect(this.contracts.archiver.isArchived(op.sourceChainId, ethers.ZeroHash, op.sourceLogIndex)).to
        .eventually.be.true;
    });

    it('success - version increments monotonically', async function () {
      const op = this.makeArchiveOp();

      for (let i = 1; i <= 10; ++i) {
        await this.archive(op);
        await expect(
          this.contracts.archiver.latestVersion(op.sourceChainId, op.sourceTxHash, op.sourceLogIndex)
        ).to.eventually.equal(i);
      }
    });

    it('reverts - unauthorized caller', async function () {
      const op = this.makeArchiveOp();
      await expect(this.archive(op, this.accounts.other))
        .to.be.revertedWithCustomError(this.contracts.archiver, 'RestrictedAccess')
        .withArgs(
          this.accounts.other,
          this.contracts.archiver,
          this.contracts.archiver.interface.getFunction('archiveEvent').selector
        );
    });
  });

  describe('ERC165', function () {
    it('supports the archive interfaces and IERC165', async function () {
      await expect(this.contracts.archiver.supportsInterface(IFACE.IEventArchive)).to.eventually.be.true;
      await expect(this.contracts.archiver.supportsInterface(IFACE.IEventArchiveWriter)).to.eventually.be.true;
      await expect(this.contracts.archiver.supportsInterface(IFACE.IERC165)).to.eventually.be.true;
    });

    it('does not support 0xffffffff', async function () {
      await expect(this.contracts.archiver.supportsInterface('0xffffffff')).to.eventually.be.false;
    });
  });

  describe('multicall', function () {
    it('batches multiple archiveEvent calls', async function () {
      const op1 = this.makeArchiveOp();
      const op2 = this.makeArchiveOp();

      const data = [op1, op2].map((op) =>
        this.contracts.archiver.interface.encodeFunctionData('archiveEvent', [
          op.sourceChainId,
          op.sourceTxHash,
          op.sourceAddress,
          op.sourceLogIndex,
          op.sourceBlockNumber,
          op.payload,
        ])
      );

      await expect(this.contracts.archiver.connect(this.accounts.archiver).multicall(data)).to.emit(
        this.contracts.archiver,
        'EventArchived'
      );

      await expect(this.contracts.archiver.isArchived(op1.sourceChainId, op1.sourceTxHash, op1.sourceLogIndex)).to
        .eventually.be.true;
      await expect(this.contracts.archiver.isArchived(op2.sourceChainId, op2.sourceTxHash, op2.sourceLogIndex)).to
        .eventually.be.true;
    });
  });
});
