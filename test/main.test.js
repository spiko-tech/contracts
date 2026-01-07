const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');
const { deploy } = require('@amxx/hre/scripts');
const { migrate } = require('../scripts/migrate');
const { Enum, toMask, combine, getDomain } = require('./helpers');

const STATUS = Enum('NULL', 'PENDING', 'EXECUTED', 'CANCELED');

const getAddress = (account) => account.address ?? account.target ?? account;

const divUp = (numerator, denominator) =>
  (numerator / denominator) * denominator < numerator ? numerator / denominator + 1n : numerator / denominator;

async function fixture() {
  const accounts = await ethers.getSigners();
  accounts.admin = accounts.shift();
  accounts.operator = accounts.shift();
  accounts.whitelister = accounts.shift();
  accounts.alice = accounts.shift();
  accounts.bruce = accounts.shift();
  accounts.chris = accounts.shift();
  accounts.other = accounts.shift();

  const { contracts, config, roles } = await migrate(
    {
      deployer: accounts.admin,
      roles: {
        admin: { members: [accounts.admin].map(getAddress) },
        'operator-exceptional': { members: [accounts.operator].map(getAddress) },
        'operator-daily': { members: [accounts.operator, 'minter'].map(getAddress) },
        'operator-oracle': { members: [accounts.operator].map(getAddress) },
        burner: { members: ['redemption'].map(getAddress) },
        whitelister: { members: [accounts.whitelister].map(getAddress) },
        whitelisted: { members: [accounts.alice, accounts.bruce, 'redemption'].map(getAddress) },
        'mint-initiator': { members: [accounts.operator].map(getAddress) },
        'mint-approver': { members: [accounts.admin].map(getAddress) },
      },
    },
    { noCache: true, noConfirm: true }
  );

  // get token + oracle
  contracts.token = Object.values(contracts.tokens).find(Boolean);
  contracts.oracle = Object.values(contracts.oracles).find(Boolean);

  await expect(contracts.oracle.token()).to.eventually.equal(contracts.token, 'Invalid configuration for testing');

  return {
    accounts,
    contracts,
    config,
    tokenConfig: config.contracts.tokens.find(Boolean),
    oracleConfig: config.contracts.tokens.find(Boolean).oracle,
    ...roles,
  };
}

describe('Main', function () {
  beforeEach(async function () {
    await loadFixture(fixture).then((results) => Object.assign(this, results));
  });

  it('post deployment state', async function () {
    expect(await this.contracts.manager.ADMIN()).to.equal(this.IDS.admin);
    expect(await this.contracts.manager.PUBLIC()).to.equal(this.IDS.public);
    expect(await this.contracts.manager.ADMIN_MASK()).to.equal(this.MASKS.admin);
    expect(await this.contracts.manager.PUBLIC_MASK()).to.equal(this.MASKS.public);

    expect(await this.contracts.token.authority()).to.equal(this.contracts.manager);
    expect(await this.contracts.token.name()).to.equal(this.tokenConfig.name);
    expect(await this.contracts.token.symbol()).to.equal(this.tokenConfig.symbol);
    expect(await this.contracts.token.decimals()).to.equal(this.tokenConfig.decimals);
    expect(await this.contracts.token.totalSupply()).to.equal(0);

    expect(await this.contracts.oracle.authority()).to.equal(this.contracts.manager);
    expect(await this.contracts.oracle.token()).to.equal(this.contracts.token);
    expect(await this.contracts.oracle.version()).to.equal(0);
    expect(await this.contracts.oracle.decimals()).to.equal(this.oracleConfig.decimals);
    expect(await this.contracts.oracle.description()).to.equal(
      `${this.tokenConfig.symbol} / ${this.oracleConfig.quote}`
    );
  });

  it('accounts have permissions', async function () {
    expect(await this.contracts.manager.getGroups(this.contracts.redemption)).to.equal(
      combine(this.MASKS.public, this.MASKS.burner, this.MASKS.whitelisted)
    );
    expect(await this.contracts.manager.getGroups(this.accounts.admin)).to.equal(
      combine(this.MASKS.public, this.MASKS.admin, this.MASKS['mint-approver'])
    );
    expect(await this.contracts.manager.getGroups(this.accounts.operator)).to.equal(
      combine(
        this.MASKS.public,
        this.MASKS['operator-daily'],
        this.MASKS['operator-exceptional'],
        this.MASKS['operator-oracle'],
        this.MASKS['mint-initiator']
      )
    );
    expect(await this.contracts.manager.getGroups(this.accounts.whitelister)).to.equal(
      combine(this.MASKS.public, this.MASKS.whitelister)
    );
    expect(await this.contracts.manager.getGroups(this.accounts.alice)).to.equal(
      combine(this.MASKS.public, this.MASKS.whitelisted)
    );
    expect(await this.contracts.manager.getGroups(this.accounts.bruce)).to.equal(
      combine(this.MASKS.public, this.MASKS.whitelisted)
    );
    expect(await this.contracts.manager.getGroups(this.accounts.chris)).to.equal(combine(this.MASKS.public));
  });

  it('functions have requirements', async function () {
    // token
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.token,
        this.contracts.token.interface.getFunction('upgradeToAndCall').selector
      )
    ).to.equal(combine(this.MASKS.admin));
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.token,
        this.contracts.token.interface.getFunction('mint').selector
      )
    ).to.equal(combine(this.MASKS.admin, this.MASKS['operator-daily']));
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.token,
        this.contracts.token.interface.getFunction('burn').selector
      )
    ).to.equal(combine(this.MASKS.admin, this.MASKS.burner));
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.token,
        this.contracts.token.interface.getFunction('pause').selector
      )
    ).to.equal(combine(this.MASKS.admin, this.MASKS['operator-exceptional']));
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.token,
        this.contracts.token.interface.getFunction('unpause').selector
      )
    ).to.equal(combine(this.MASKS.admin, this.MASKS['operator-exceptional']));
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.token,
        this.contracts.token.interface.getFunction('transfer').selector
      )
    ).to.equal(combine(this.MASKS.admin, this.MASKS.whitelisted));
    // oracle
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.oracle,
        this.contracts.oracle.interface.getFunction('upgradeToAndCall').selector
      )
    ).to.equal(combine(this.MASKS.admin));
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.oracle,
        this.contracts.oracle.interface.getFunction('publishPrice').selector
      )
    ).to.equal(combine(this.MASKS.admin, this.MASKS['operator-oracle']));
    // redemption
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.redemption,
        this.contracts.redemption.interface.getFunction('upgradeToAndCall').selector
      )
    ).to.equal(combine(this.MASKS.admin));
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.redemption,
        this.contracts.redemption.interface.getFunction('registerOutput').selector
      )
    ).to.equal(combine(this.MASKS.admin));
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.redemption,
        this.contracts.redemption.interface.getFunction('setMinimum').selector
      )
    ).to.equal(combine(this.MASKS.admin));
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.redemption,
        this.contracts.redemption.interface.getFunction('executeRedemption').selector
      )
    ).to.equal(combine(this.MASKS.admin, this.MASKS['operator-daily']));
    // minter
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.minter,
        this.contracts.minter.interface.getFunction('upgradeToAndCall').selector
      )
    ).to.equal(combine(this.MASKS.admin));
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.minter,
        this.contracts.minter.interface.getFunction('initiateMint').selector
      )
    ).to.equal(combine(this.MASKS.admin, this.MASKS['mint-initiator']));
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.minter,
        this.contracts.minter.interface.getFunction('approveMint').selector
      )
    ).to.equal(combine(this.MASKS.admin, this.MASKS['mint-approver']));
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.minter,
        this.contracts.minter.interface.getFunction('cancelMint').selector
      )
    ).to.equal(combine(this.MASKS.admin, this.MASKS['mint-approver']));
    expect(
      await this.contracts.manager.getRequirements(
        this.contracts.minter,
        this.contracts.minter.interface.getFunction('setDailyLimit').selector
      )
    ).to.equal(combine(this.MASKS.admin));
  });

  describe('Token', function () {
    describe('EIP721', function () {
      beforeEach(async function () {
        this.expectedDomain = await ethers.provider.getNetwork().then((network) => ({
          name: this.tokenConfig.name,
          version: '1',
          chainId: network.chainId,
          verifyingContract: this.contracts.token.target,
        }));
      });

      it('domain is correct', async function () {
        expect(await getDomain(this.contracts.token)).to.deep.equal(this.expectedDomain);
      });

      it('domain separator is correct', async function () {
        expect(await this.contracts.token.DOMAIN_SEPARATOR()).to.equal(
          ethers.TypedDataEncoder.hashDomain(this.expectedDomain)
        );
      });
    });

    describe('ERC20', function () {
      describe('mint', function () {
        it('authorized', async function () {
          await expect(this.contracts.token.connect(this.accounts.operator).mint(this.accounts.alice, 1000))
            .to.emit(this.contracts.token, 'Transfer')
            .withArgs(ethers.ZeroAddress, this.accounts.alice, 1000);
        });

        it('unauthorized caller (need operator)', async function () {
          await expect(this.contracts.token.connect(this.accounts.alice).mint(this.accounts.alice, 1000))
            .to.be.revertedWithCustomError(this.contracts.token, 'RestrictedAccess')
            .withArgs(
              this.accounts.alice,
              this.contracts.token,
              this.contracts.token.interface.getFunction('mint').selector
            );
        });

        it('unauthorized to (need whitelisted)', async function () {
          await expect(this.contracts.token.connect(this.accounts.operator).mint(this.accounts.chris, 1000))
            .to.be.revertedWithCustomError(this.contracts.token, 'UnauthorizedTo')
            .withArgs(this.contracts.token, this.accounts.chris);
        });
      });

      describe('burn', function () {
        beforeEach(async function () {
          await this.contracts.token.connect(this.accounts.operator).mint(this.accounts.alice, 1000);
        });

        it('authorized', async function () {
          await expect(this.contracts.token.connect(this.accounts.admin).burn(this.accounts.alice, 100))
            .to.emit(this.contracts.token, 'Transfer')
            .withArgs(this.accounts.alice, ethers.ZeroAddress, 100);
        });

        it('unauthorized caller (need admin)', async function () {
          await expect(this.contracts.token.connect(this.accounts.alice).burn(this.accounts.alice, 100))
            .to.be.revertedWithCustomError(this.contracts.token, 'RestrictedAccess')
            .withArgs(
              this.accounts.alice,
              this.contracts.token,
              this.contracts.token.interface.getFunction('burn').selector
            );
        });

        it('can burn from not-whitelisted account', async function () {
          // whitelist, mint, blacklist
          await Promise.all([
            this.contracts.manager
              .connect(this.accounts.whitelister)
              .addGroup(this.accounts.chris, this.IDS.whitelisted),
            this.contracts.token.connect(this.accounts.operator).mint(this.accounts.chris, 1000),
            this.contracts.manager
              .connect(this.accounts.whitelister)
              .remGroup(this.accounts.chris, this.IDS.whitelisted),
          ]);

          await expect(this.contracts.token.connect(this.accounts.admin).burn(this.accounts.chris, 100))
            .to.emit(this.contracts.token, 'Transfer')
            .withArgs(this.accounts.chris, ethers.ZeroAddress, 100);
        });
      });

      describe('transfers', function () {
        beforeEach(async function () {
          this.mock = await deploy('ERC1363ReceiverMock');
          await this.contracts.token.connect(this.accounts.operator).mint(this.accounts.alice, 1000);
        });

        for (const fn of ['transfer', 'transferFrom', 'transferAndCall', 'transferFromAndCall'])
          describe(fn, function () {
            for (const fromAuthorized of [true, false])
              for (const toAuthorized of [true, false]) {
                it(
                  [
                    fromAuthorized ? 'from authorized' : 'from unauthorized',
                    '+',
                    toAuthorized ? 'to authorized' : 'to unauthorized',
                    '=',
                    fromAuthorized && toAuthorized ? 'ok' : 'revert',
                  ].join(' '),
                  async function () {
                    let from = this.accounts.alice; // Alice has tokens to send
                    let to = this.mock; // ERC1363 compatible receiver
                    let operator = fn.includes('From') ? this.accounts.other : null;
                    let amount = 10;

                    // set approval if needed + configure sender and receiver
                    operator && (await this.contracts.token.connect(from).approve(operator, amount));
                    await this.contracts.manager
                      .connect(this.accounts.whitelister)
                      [fromAuthorized ? 'addGroup' : 'remGroup'](from, this.IDS.whitelisted);
                    await this.contracts.manager
                      .connect(this.accounts.whitelister)
                      [toAuthorized ? 'addGroup' : 'remGroup'](to, this.IDS.whitelisted);

                    let promise = null;
                    switch (fn) {
                      case 'transfer':
                        promise = this.contracts.token.connect(from).transfer(to, amount);
                        break;
                      case 'transferFrom':
                        promise = this.contracts.token.connect(operator).transferFrom(from, to, amount);
                        break;
                      case 'transferAndCall':
                        promise = this.contracts.token.connect(from).getFunction('transferAndCall(address,uint256)')(
                          to,
                          amount
                        );
                        break;
                      case 'transferFromAndCall':
                        promise = this.contracts.token
                          .connect(operator)
                          .getFunction('transferFromAndCall(address,address,uint256)')(from, to, amount);
                        break;
                    }

                    await (fromAuthorized && toAuthorized
                      ? expect(promise).to.emit(this.contracts.token, 'Transfer').withArgs(from, to, amount)
                      : expect(promise)
                          .to.be.revertedWithCustomError(
                            this.contracts.token,
                            (!fromAuthorized && 'UnauthorizedFrom') || (!toAuthorized && 'UnauthorizedTo')
                          )
                          .withArgs(this.contracts.token, (!fromAuthorized && from) || (!toAuthorized && to)));
                  }
                );
              }
          });
      });

      describe('pause', function () {
        it('authorized', async function () {
          await expect(this.contracts.token.connect(this.accounts.operator).pause())
            .to.emit(this.contracts.token, 'Paused')
            .withArgs(this.accounts.operator);
        });

        it('unauthorized caller (need operator)', async function () {
          await expect(this.contracts.token.connect(this.accounts.alice).pause())
            .to.be.revertedWithCustomError(this.contracts.token, 'RestrictedAccess')
            .withArgs(
              this.accounts.alice,
              this.contracts.token,
              this.contracts.token.interface.getFunction('pause').selector
            );
        });

        it('pausing disables transfers', async function () {
          await this.contracts.token.connect(this.accounts.operator).pause();

          await expect(
            this.contracts.token.connect(this.accounts.alice).transfer(this.accounts.bruce, 0)
          ).to.be.revertedWithCustomError(this.contracts.token, 'EnforcedPause');
        });
      });

      describe('unpause', function () {
        beforeEach(async function () {
          await this.contracts.token.connect(this.accounts.operator).pause();
        });

        it('authorized', async function () {
          await expect(this.contracts.token.connect(this.accounts.operator).unpause())
            .to.emit(this.contracts.token, 'Unpaused')
            .withArgs(this.accounts.operator);
        });

        it('unauthorized caller (need operator)', async function () {
          await expect(this.contracts.token.connect(this.accounts.alice).unpause())
            .to.be.revertedWithCustomError(this.contracts.token, 'RestrictedAccess')
            .withArgs(
              this.accounts.alice,
              this.contracts.token,
              this.contracts.token.interface.getFunction('unpause').selector
            );
        });

        it('unpausing re-enables transfers', async function () {
          await this.contracts.token.connect(this.accounts.operator).unpause();

          await expect(this.contracts.token.connect(this.accounts.alice).transfer(this.accounts.bruce, 0))
            .to.emit(this.contracts.token, 'Transfer')
            .withArgs(this.accounts.alice, this.accounts.bruce, 0);
        });
      });
    });

    describe('ERC1363', function () {
      const value = 1000n;

      beforeEach(async function () {
        this.mock = await deploy('ERC1363ReceiverMock');

        (await this.contracts.manager.connect(this.accounts.whitelister).addGroup(this.mock, this.IDS.whitelisted),
          await this.contracts.token.connect(this.accounts.operator).mint(this.accounts.alice, value));
      });

      describe('transferAndCall', function () {
        it('without data', async function () {
          const data = '0x';

          await expect(
            this.contracts.token.connect(this.accounts.alice).getFunction('transferAndCall(address,uint256)')(
              this.mock,
              value
            )
          )
            .to.emit(this.contracts.token, 'Transfer')
            .withArgs(this.accounts.alice, this.mock, value)
            .to.emit(this.mock, 'TransferReceived')
            .withArgs(this.accounts.alice, this.accounts.alice, value, data);
        });

        it('with data', async function () {
          const data = '0x123456';

          await expect(
            this.contracts.token.connect(this.accounts.alice).getFunction('transferAndCall(address,uint256,bytes)')(
              this.mock,
              value,
              data
            )
          )
            .to.emit(this.contracts.token, 'Transfer')
            .withArgs(this.accounts.alice, this.mock, value)
            .to.emit(this.mock, 'TransferReceived')
            .withArgs(this.accounts.alice, this.accounts.alice, value, data);
        });

        it('with reverting hook (with reason)', async function () {
          const data = '0x00';

          await expect(
            this.contracts.token.connect(this.accounts.alice).getFunction('transferAndCall(address,uint256,bytes)')(
              this.mock,
              value,
              data
            )
          ).to.be.revertedWith('onTransferReceived revert');
        });

        it('with reverting hook (without reason)', async function () {
          const data = '0x01';

          await expect(
            this.contracts.token.connect(this.accounts.alice).getFunction('transferAndCall(address,uint256,bytes)')(
              this.mock,
              value,
              data
            )
          ).to.be.revertedWith('ERC1363: onTransferReceived reverted without reason');
        });

        it('with bad return value', async function () {
          const data = '0x02';

          await expect(
            this.contracts.token.connect(this.accounts.alice).getFunction('transferAndCall(address,uint256,bytes)')(
              this.mock,
              value,
              data
            )
          ).to.be.revertedWith('ERC1363: onTransferReceived invalid result');
        });
      });

      describe('transferFromAndCall', function () {
        beforeEach(async function () {
          await this.contracts.token.connect(this.accounts.alice).approve(this.accounts.bruce, ethers.MaxUint256);
        });

        it('without data', async function () {
          const data = '0x';

          await expect(
            this.contracts.token
              .connect(this.accounts.bruce)
              .getFunction('transferFromAndCall(address,address,uint256)')(this.accounts.alice, this.mock, value)
          )
            .to.emit(this.contracts.token, 'Transfer')
            .withArgs(this.accounts.alice, this.mock, value)
            .to.emit(this.mock, 'TransferReceived')
            .withArgs(this.accounts.bruce, this.accounts.alice, value, data);
        });

        it('with data', async function () {
          const data = '0x123456';

          await expect(
            this.contracts.token
              .connect(this.accounts.bruce)
              .getFunction('transferFromAndCall(address,address,uint256,bytes)')(
              this.accounts.alice,
              this.mock,
              value,
              data
            )
          )
            .to.emit(this.contracts.token, 'Transfer')
            .withArgs(this.accounts.alice, this.mock, value)
            .to.emit(this.mock, 'TransferReceived')
            .withArgs(this.accounts.bruce, this.accounts.alice, value, data);
        });

        it('with reverting hook (with reason)', async function () {
          const data = '0x00';

          await expect(
            this.contracts.token
              .connect(this.accounts.bruce)
              .getFunction('transferFromAndCall(address,address,uint256,bytes)')(
              this.accounts.alice,
              this.mock,
              value,
              data
            )
          ).to.be.revertedWith('onTransferReceived revert');
        });

        it('with reverting hook (without reason)', async function () {
          const data = '0x01';

          await expect(
            this.contracts.token
              .connect(this.accounts.bruce)
              .getFunction('transferFromAndCall(address,address,uint256,bytes)')(
              this.accounts.alice,
              this.mock,
              value,
              data
            )
          ).to.be.revertedWith('ERC1363: onTransferReceived reverted without reason');
        });

        it('with bad return value', async function () {
          const data = '0x02';

          await expect(
            this.contracts.token
              .connect(this.accounts.bruce)
              .getFunction('transferFromAndCall(address,address,uint256,bytes)')(
              this.accounts.alice,
              this.mock,
              value,
              data
            )
          ).to.be.revertedWith('ERC1363: onTransferReceived invalid result');
        });
      });

      describe('approveAndCall', function () {
        it('without data', async function () {
          const data = '0x';

          await expect(
            this.contracts.token.connect(this.accounts.alice).getFunction('approveAndCall(address,uint256)')(
              this.mock,
              value
            )
          )
            .to.emit(this.contracts.token, 'Approval')
            .withArgs(this.accounts.alice, this.mock, value)
            .to.emit(this.mock, 'ApprovalReceived')
            .withArgs(this.accounts.alice, value, data);
        });

        it('with data', async function () {
          const data = '0x123456';

          await expect(
            this.contracts.token.connect(this.accounts.alice).getFunction('approveAndCall(address,uint256,bytes)')(
              this.mock,
              value,
              data
            )
          )
            .to.emit(this.contracts.token, 'Approval')
            .withArgs(this.accounts.alice, this.mock, value)
            .to.emit(this.mock, 'ApprovalReceived')
            .withArgs(this.accounts.alice, value, data);
        });

        it('with reverting hook (with reason)', async function () {
          const data = '0x00';

          await expect(
            this.contracts.token.connect(this.accounts.alice).getFunction('approveAndCall(address,uint256,bytes)')(
              this.mock,
              value,
              data
            )
          ).to.be.revertedWith('onApprovalReceived revert');
        });

        it('with reverting hook (without reason)', async function () {
          const data = '0x01';

          await expect(
            this.contracts.token.connect(this.accounts.alice).getFunction('approveAndCall(address,uint256,bytes)')(
              this.mock,
              value,
              data
            )
          ).to.be.revertedWith('ERC1363: onApprovalReceived reverted without reason');
        });

        it('with bad return value', async function () {
          const data = '0x02';

          await expect(
            this.contracts.token.connect(this.accounts.alice).getFunction('approveAndCall(address,uint256,bytes)')(
              this.mock,
              value,
              data
            )
          ).to.be.revertedWith('ERC1363: onApprovalReceived invalid result');
        });
      });
    });

    describe('Ownable', function () {
      it('Set initial ownership', async function () {
        expect(await this.contracts.token.owner()).to.equal(ethers.ZeroAddress);

        await expect(this.contracts.token.connect(this.accounts.admin).setOwnership(this.accounts.alice))
          .to.emit(this.contracts.token, 'OwnershipTransferred')
          .withArgs(ethers.ZeroAddress, this.accounts.alice);

        expect(await this.contracts.token.owner()).to.equal(this.accounts.alice);
      });

      it('Reset ownership', async function () {
        await this.contracts.token.connect(this.accounts.admin).setOwnership(this.accounts.alice);

        expect(await this.contracts.token.owner()).to.equal(this.accounts.alice);

        await expect(this.contracts.token.connect(this.accounts.admin).setOwnership(this.accounts.bruce))
          .to.emit(this.contracts.token, 'OwnershipTransferred')
          .withArgs(this.accounts.alice, this.accounts.bruce);

        expect(await this.contracts.token.owner()).to.equal(this.accounts.bruce);
      });

      it('Setting ownership is access restricted', async function () {
        await expect(this.contracts.token.connect(this.accounts.alice).setOwnership(this.accounts.alice))
          .to.be.revertedWithCustomError(this.contracts.oracle, 'RestrictedAccess')
          .withArgs(
            this.accounts.alice,
            this.contracts.token,
            this.contracts.token.interface.getFunction('setOwnership').selector
          );
      });
    });
  });

  describe('Oracle', function () {
    describe('publish price', function () {
      it('authorized', async function () {
        const roundId = 0;
        const value = 17;
        const timepoint = 42;

        expect(await this.contracts.oracle.getLatestPrice()).to.equal(0);
        await expect(this.contracts.oracle.latestRoundData()).to.be.reverted;

        await expect(this.contracts.oracle.connect(this.accounts.operator).publishPrice(timepoint, value))
          .to.emit(this.contracts.oracle, 'Update')
          .withArgs(timepoint, value, roundId);

        expect(await this.contracts.oracle.getLatestPrice()).to.equal(value);

        const latestRoundData = await this.contracts.oracle.latestRoundData();
        expect(latestRoundData.roundId).to.equal(roundId);
        expect(latestRoundData.answer).to.equal(value);
        expect(latestRoundData.startedAt).to.equal(timepoint);
        expect(latestRoundData.updatedAt).to.equal(timepoint);
        expect(latestRoundData.answeredInRound).to.equal(roundId);

        const getRoundData = await this.contracts.oracle.getRoundData(roundId);
        expect(getRoundData.roundId).to.equal(roundId);
        expect(getRoundData.answer).to.equal(value);
        expect(getRoundData.startedAt).to.equal(timepoint);
        expect(getRoundData.updatedAt).to.equal(timepoint);
        expect(getRoundData.answeredInRound).to.equal(roundId);
      });

      it('unauthorized caller (need operator)', async function () {
        await expect(this.contracts.oracle.connect(this.accounts.other).publishPrice(42, 17))
          .to.be.revertedWithCustomError(this.contracts.oracle, 'RestrictedAccess')
          .withArgs(
            this.accounts.other,
            this.contracts.oracle,
            this.contracts.oracle.interface.getFunction('publishPrice').selector
          );
      });

      it('updates last entry', async function () {
        const rounds = [
          { timepoint: 17, value: 1 },
          { timepoint: 42, value: 6 },
          { timepoint: 69, value: 3 },
          { timepoint: 81, value: 9 },
        ];

        for (const [roundId, { timepoint, value }] of Object.entries(rounds)) {
          await expect(this.contracts.oracle.connect(this.accounts.operator).publishPrice(timepoint, value))
            .to.emit(this.contracts.oracle, 'Update')
            .withArgs(timepoint, value, roundId);

          expect(await this.contracts.oracle.getLatestPrice()).to.equal(value);

          const latestRoundData = await this.contracts.oracle.latestRoundData();
          expect(latestRoundData.roundId).to.equal(roundId);
          expect(latestRoundData.answer).to.equal(value);
          expect(latestRoundData.startedAt).to.equal(timepoint);
          expect(latestRoundData.updatedAt).to.equal(timepoint);
          expect(latestRoundData.answeredInRound).to.equal(roundId);
        }

        for (const [roundId, { timepoint, value }] of Object.entries(rounds)) {
          const getRoundData = await this.contracts.oracle.getRoundData(roundId);
          expect(getRoundData.roundId).to.equal(roundId);
          expect(getRoundData.answer).to.equal(value);
          expect(getRoundData.startedAt).to.equal(timepoint);
          expect(getRoundData.updatedAt).to.equal(timepoint);
          expect(getRoundData.answeredInRound).to.equal(roundId);
        }
      });
    });

    it('getHistoricalPrice', async function () {
      const rounds = [
        { timepoint: 17, value: 1 },
        { timepoint: 42, value: 6 },
        { timepoint: 69, value: 3 },
        { timepoint: 81, value: 9 },
      ];

      // Fill the oracle with data
      for (const { timepoint, value } of rounds) {
        await this.contracts.oracle.connect(this.accounts.operator).publishPrice(timepoint, value);
      }

      // Perform lookups
      for (const t of Array.range(rounds.at(-1).timepoint + 2)) {
        expect(await this.contracts.oracle.getHistoricalPrice(t)).to.equal(
          rounds.findLast(({ timepoint }) => timepoint <= t)?.value ?? 0
        );
      }
    });

    it('get non-existing data', async function () {
      await expect(this.contracts.oracle.getRoundData(42)).to.be.revertedWith('No checkpoint for roundId');
    });
  });

  describe('ATM v1', function () {
    for (const stableDecimal of [6, 18, 36]) {
      describe(`stable coin with ${stableDecimal} decimals`, function () {
        const formatToken = (value) => ethers.parseUnits(value, 5);
        const formatStable = (value) => ethers.parseUnits(value, stableDecimal);

        beforeEach(async function () {
          /// deployment
          this.contracts.stable = await deploy('ERC20DecimalsMock', [stableDecimal]);
          this.contracts.atm = await deploy('ATM', [
            this.contracts.oracle.target,
            this.contracts.stable.target,
            this.contracts.manager.target,
            this.contracts.forwarder.target,
          ]);

          ///. set atm permissions
          await this.contracts.manager.setRequirements(
            this.contracts.atm,
            [this.contracts.atm.interface.getFunction('drain').selector],
            [this.IDS['operator-exceptional']]
          );
          await this.contracts.manager.addGroup(this.contracts.atm, this.IDS['whitelisted']);

          /// mint and approve
          await this.contracts.token.mint(this.contracts.atm, formatToken('100'));
          await this.contracts.stable.mint(this.contracts.atm, formatStable('100'));
          await this.contracts.token.mint(this.accounts.alice, formatToken('100'));
          await this.contracts.stable.mint(this.accounts.bruce, formatStable('100'));
          await this.contracts.token.connect(this.accounts.alice).approve(this.contracts.atm, ethers.MaxUint256);
          await this.contracts.stable.connect(this.accounts.bruce).approve(this.contracts.atm, ethers.MaxUint256);
        });

        it('post deployment state', async function () {
          expect(await this.contracts.atm.token()).to.equal(this.contracts.token.target);
          expect(await this.contracts.atm.stable()).to.equal(this.contracts.stable.target);
          expect(await this.contracts.atm.oracle()).to.equal(this.contracts.oracle.target);
        });

        describe('with price set', function () {
          beforeEach(async function () {
            const timestamp = await time.latest();
            await this.contracts.oracle.publishPrice(timestamp - 3600, ethers.parseUnits('2', 6));
            await this.contracts.oracle.publishPrice(timestamp + 3600, ethers.parseUnits('3', 6));
          });

          describe('buy', function () {
            it('preview', async function () {
              expect(await this.contracts.atm.previewBuy(this.contracts.stable, formatStable('1.0'))).to.deep.equal([
                formatToken('0.5'),
                formatStable('1.0'),
              ]);
              expect(
                await this.contracts.atm.previewBuy(this.contracts.stable, formatStable('1.000001'))
              ).to.deep.equal([formatToken('0.5'), formatStable('1.000001')]); // round down
              expect(await this.contracts.atm.previewBuy(this.contracts.token, formatToken('1.0'))).to.deep.equal([
                formatToken('1.0'),
                formatStable('2.0'),
              ]);
              expect(await this.contracts.atm.previewBuy(this.contracts.token, formatToken('1.00001'))).to.deep.equal([
                formatToken('1.00001'),
                formatStable('2.00002'),
              ]);
              await expect(this.contracts.atm.previewBuy(this.contracts.manager, 0)).to.be.revertedWith(
                'invalid input token'
              );
            });

            it('buy (given amount of stable)', async function () {
              const amountStable = formatStable('1.000001');
              const amountToken = formatToken('0.5');

              const tx = this.contracts.atm
                .connect(this.accounts.bruce)
                .buy(this.contracts.stable, amountStable, this.accounts.alice);
              await expect(tx).to.changeTokenBalances(
                this.contracts.stable,
                [this.accounts.bruce, this.contracts.atm],
                [-amountStable, amountStable]
              );
              await expect(tx).to.changeTokenBalances(
                this.contracts.token,
                [this.accounts.alice, this.contracts.atm],
                [amountToken, -amountToken]
              );
            });

            it('buy (given amount of token)', async function () {
              const amountToken = formatToken('1.00001');
              const amountStable = formatStable('2.00002');

              const tx = this.contracts.atm
                .connect(this.accounts.bruce)
                .buy(this.contracts.token, amountToken, this.accounts.alice);
              await expect(tx).to.changeTokenBalances(
                this.contracts.stable,
                [this.accounts.bruce, this.contracts.atm],
                [-amountStable, amountStable]
              );
              await expect(tx).to.changeTokenBalances(
                this.contracts.token,
                [this.accounts.alice, this.contracts.atm],
                [amountToken, -amountToken]
              );
            });
          });

          describe('sell', function () {
            it('preview', async function () {
              expect(await this.contracts.atm.previewSell(this.contracts.stable, formatStable('1.0'))).to.deep.equal([
                formatToken('0.5'),
                formatStable('1.0'),
              ]);
              expect(
                await this.contracts.atm.previewSell(this.contracts.stable, formatStable('1.000001'))
              ).to.deep.equal([formatToken('0.50001'), formatStable('1.000001')]); // round up
              expect(await this.contracts.atm.previewSell(this.contracts.token, formatToken('1.0'))).to.deep.equal([
                formatToken('1.0'),
                formatStable('2.0'),
              ]);
              expect(await this.contracts.atm.previewSell(this.contracts.token, formatToken('1.00001'))).to.deep.equal([
                formatToken('1.00001'),
                formatStable('2.00002'),
              ]);
              await expect(this.contracts.atm.previewSell(this.contracts.manager, 0)).to.be.revertedWith(
                'invalid input token'
              );
            });

            it('sell (given amount of stable)', async function () {
              const amountStable = formatStable('1.000001');
              const amountToken = formatToken('0.50001');

              const tx = this.contracts.atm
                .connect(this.accounts.alice)
                .sell(this.contracts.stable, amountStable, this.accounts.bruce);
              await expect(tx).to.changeTokenBalances(
                this.contracts.stable,
                [this.accounts.bruce, this.contracts.atm],
                [amountStable, -amountStable]
              );
              await expect(tx).to.changeTokenBalances(
                this.contracts.token,
                [this.accounts.alice, this.contracts.atm],
                [-amountToken, amountToken]
              );
            });

            it('sell (given amount of token)', async function () {
              const amountToken = formatToken('1.00001');
              const amountStable = formatStable('2.00002');

              const tx = this.contracts.atm
                .connect(this.accounts.alice)
                .sell(this.contracts.token, amountToken, this.accounts.bruce);
              await expect(tx).to.changeTokenBalances(
                this.contracts.stable,
                [this.accounts.bruce, this.contracts.atm],
                [amountStable, -amountStable]
              );
              await expect(tx).to.changeTokenBalances(
                this.contracts.token,
                [this.accounts.alice, this.contracts.atm],
                [-amountToken, amountToken]
              );
            });
          });

          describe('drain', function () {
            it('unauthorized', async function () {
              await expect(
                this.contracts.atm.connect(this.accounts.other).drain(this.contracts.token, this.accounts.alice, 1)
              )
                .to.be.revertedWithCustomError(this.contracts.atm, 'RestrictedAccess')
                .withArgs(
                  this.accounts.other,
                  this.contracts.atm,
                  this.contracts.atm.interface.getFunction('drain').selector
                );
            });

            it('partial', async function () {
              await expect(
                this.contracts.atm.connect(this.accounts.admin).drain(this.contracts.token, this.accounts.alice, 42)
              ).to.changeTokenBalances(this.contracts.token, [this.contracts.atm, this.accounts.alice], [-42, 42]);
            });

            it('total', async function () {
              const balance = await this.contracts.token.balanceOf(this.contracts.atm);
              await expect(
                this.contracts.atm
                  .connect(this.accounts.admin)
                  .drain(this.contracts.token, this.accounts.alice, ethers.MaxUint256)
              ).to.changeTokenBalances(
                this.contracts.token,
                [this.contracts.atm, this.accounts.alice],
                [-balance, balance]
              );
            });
          });
        });
      });
    }
  });

  describe('ATM v2', function () {
    const oraclettl = time.duration.days(7);

    for (const stableDecimal of [6, 18, 36]) {
      describe(`stable coin with ${stableDecimal} decimals`, function () {
        const formatToken = (value) => ethers.parseUnits(value, 5);
        const formatStable = (value) => ethers.parseUnits(value, stableDecimal);

        beforeEach(async function () {
          /// deployment
          this.contracts.stable = await deploy('ERC20DecimalsMock', [stableDecimal]);
          this.contracts.atm = await deploy('ATM2', [
            this.contracts.oracle.target,
            this.contracts.stable.target,
            this.contracts.manager.target,
            this.contracts.forwarder.target,
            oraclettl,
          ]);

          ///. set atm permissions
          await this.contracts.manager.setRequirements(
            this.contracts.atm,
            [this.contracts.atm.interface.getFunction('drain').selector],
            [this.IDS['operator-exceptional']]
          );
          await this.contracts.manager.addGroup(this.contracts.atm, this.IDS['whitelisted']);

          /// mint and approve
          await this.contracts.token.mint(this.contracts.atm, formatToken('100'));
          await this.contracts.stable.mint(this.contracts.atm, formatStable('100'));
          await this.contracts.token.mint(this.accounts.alice, formatToken('100'));
          await this.contracts.stable.mint(this.accounts.bruce, formatStable('100'));
          await this.contracts.token.connect(this.accounts.alice).approve(this.contracts.atm, ethers.MaxUint256);
          await this.contracts.stable.connect(this.accounts.bruce).approve(this.contracts.atm, ethers.MaxUint256);
        });

        it('post deployment state', async function () {
          expect(await this.contracts.atm.token()).to.equal(this.contracts.token.target);
          expect(await this.contracts.atm.stable()).to.equal(this.contracts.stable.target);
          expect(await this.contracts.atm.oracle()).to.equal(this.contracts.oracle.target);
        });

        for (const { description, oldPrice, newPrice } of [
          {
            description: 'with price increase',
            oldPrice: ethers.parseUnits('2.15467', 6),
            newPrice: ethers.parseUnits('2.17832', 6),
          },
          {
            description: 'with price decrease',
            oldPrice: ethers.parseUnits('2.17832', 6),
            newPrice: ethers.parseUnits('2.15467', 6),
          },
        ])
          describe(description, function () {
            const buyPrice = oldPrice > newPrice ? oldPrice : newPrice;
            const sellPrice = oldPrice < newPrice ? oldPrice : newPrice;
            const numFactor = stableDecimal > 11 ? 10n ** BigInt(stableDecimal - 11) : 1n; // 11 = 5 (decimal of the token) + 6 (price scale)
            const denFactor = stableDecimal < 11 ? 10n ** BigInt(11 - stableDecimal) : 1n; // 11 = 5 (decimal of the token) + 6 (price scale)

            const stableToToken = (amount, price, up = false) =>
              up ? divUp(amount * denFactor, price * numFactor) : (amount * denFactor) / price / numFactor;

            const tokenToStable = (amount, price, up = false) =>
              up ? divUp(amount * numFactor * price, denFactor) : (amount * numFactor * price) / denFactor;

            beforeEach(async function () {
              const timestamp = await time.latest();
              await this.contracts.oracle.publishPrice(timestamp - 3600, oldPrice);
              await this.contracts.oracle.publishPrice(timestamp + 3600, newPrice);
            });

            describe('buy', function () {
              it('preview', async function () {
                expect(await this.contracts.atm.previewBuy(this.contracts.stable, formatStable('1.0'))).to.deep.equal([
                  stableToToken(formatStable('1.0'), buyPrice),
                  formatStable('1.0'),
                ]);
                expect(
                  await this.contracts.atm.previewBuy(this.contracts.stable, formatStable('1.000001'))
                ).to.deep.equal([stableToToken(formatStable('1.000001'), buyPrice), formatStable('1.000001')]); // round down
                expect(await this.contracts.atm.previewBuy(this.contracts.token, formatToken('1.0'))).to.deep.equal([
                  formatToken('1.0'),
                  tokenToStable(formatToken('1.0'), buyPrice, true),
                ]);
                expect(await this.contracts.atm.previewBuy(this.contracts.token, formatToken('1.00001'))).to.deep.equal(
                  [formatToken('1.00001'), tokenToStable(formatToken('1.00001'), buyPrice, true)]
                );
                await expect(this.contracts.atm.previewBuy(this.contracts.manager, 0)).to.be.revertedWith(
                  'invalid input token'
                );
              });

              it('buy (given amount of stable)', async function () {
                const amountStable = formatStable('1.000001');
                const amountToken = stableToToken(amountStable, buyPrice);

                const tx = this.contracts.atm
                  .connect(this.accounts.bruce)
                  .buy(this.contracts.stable, amountStable, this.accounts.alice);
                await expect(tx).to.changeTokenBalances(
                  this.contracts.stable,
                  [this.accounts.bruce, this.contracts.atm],
                  [-amountStable, amountStable]
                );
                await expect(tx).to.changeTokenBalances(
                  this.contracts.token,
                  [this.accounts.alice, this.contracts.atm],
                  [amountToken, -amountToken]
                );
              });

              it('buy (given amount of token)', async function () {
                const amountToken = formatToken('1.00001');
                const amountStable = tokenToStable(amountToken, buyPrice, true);

                const tx = this.contracts.atm
                  .connect(this.accounts.bruce)
                  .buy(this.contracts.token, amountToken, this.accounts.alice);
                await expect(tx).to.changeTokenBalances(
                  this.contracts.stable,
                  [this.accounts.bruce, this.contracts.atm],
                  [-amountStable, amountStable]
                );
                await expect(tx).to.changeTokenBalances(
                  this.contracts.token,
                  [this.accounts.alice, this.contracts.atm],
                  [amountToken, -amountToken]
                );
              });

              it('oracle not updated recently', async function () {
                await time.increase(oraclettl);
                await expect(this.contracts.atm.previewBuy(this.contracts.stable, 0)).to.be.revertedWith(
                  'oracle value too old'
                );
                await expect(this.contracts.atm.previewBuy(this.contracts.token, 0)).to.be.revertedWith(
                  'oracle value too old'
                );
                await expect(this.contracts.atm.buy(this.contracts.stable, 0, this.accounts.alice)).to.be.revertedWith(
                  'oracle value too old'
                );
                await expect(this.contracts.atm.buy(this.contracts.token, 0, this.accounts.alice)).to.be.revertedWith(
                  'oracle value too old'
                );
              });
            });

            describe('sell', function () {
              it('preview', async function () {
                expect(await this.contracts.atm.previewSell(this.contracts.stable, formatStable('1.0'))).to.deep.equal([
                  stableToToken(formatStable('1.0'), sellPrice, true),
                  formatStable('1.0'),
                ]);
                expect(
                  await this.contracts.atm.previewSell(this.contracts.stable, formatStable('1.000001'))
                ).to.deep.equal([stableToToken(formatStable('1.000001'), sellPrice, true), formatStable('1.000001')]); // round down
                expect(await this.contracts.atm.previewSell(this.contracts.token, formatToken('1.0'))).to.deep.equal([
                  formatToken('1.0'),
                  tokenToStable(formatToken('1.0'), sellPrice),
                ]);
                expect(
                  await this.contracts.atm.previewSell(this.contracts.token, formatToken('1.00001'))
                ).to.deep.equal([formatToken('1.00001'), tokenToStable(formatToken('1.00001'), sellPrice)]);
                await expect(this.contracts.atm.previewSell(this.contracts.manager, 0)).to.be.revertedWith(
                  'invalid input token'
                );
              });

              it('sell (given amount of stable)', async function () {
                const amountStable = formatStable('1.000001');
                const amountToken = stableToToken(amountStable, sellPrice, true);

                const tx = this.contracts.atm
                  .connect(this.accounts.alice)
                  .sell(this.contracts.stable, amountStable, this.accounts.bruce);
                await expect(tx).to.changeTokenBalances(
                  this.contracts.stable,
                  [this.accounts.bruce, this.contracts.atm],
                  [amountStable, -amountStable]
                );
                await expect(tx).to.changeTokenBalances(
                  this.contracts.token,
                  [this.accounts.alice, this.contracts.atm],
                  [-amountToken, amountToken]
                );
              });

              it('sell (given amount of token)', async function () {
                const amountToken = formatToken('1.00001');
                const amountStable = tokenToStable(amountToken, sellPrice);

                const tx = this.contracts.atm
                  .connect(this.accounts.alice)
                  .sell(this.contracts.token, amountToken, this.accounts.bruce);
                await expect(tx).to.changeTokenBalances(
                  this.contracts.stable,
                  [this.accounts.bruce, this.contracts.atm],
                  [amountStable, -amountStable]
                );
                await expect(tx).to.changeTokenBalances(
                  this.contracts.token,
                  [this.accounts.alice, this.contracts.atm],
                  [-amountToken, amountToken]
                );
              });

              it('oracle not updated recently', async function () {
                await time.increase(oraclettl);
                await expect(this.contracts.atm.previewSell(this.contracts.stable, 0)).to.be.revertedWith(
                  'oracle value too old'
                );
                await expect(this.contracts.atm.previewSell(this.contracts.token, 0)).to.be.revertedWith(
                  'oracle value too old'
                );
                await expect(this.contracts.atm.sell(this.contracts.stable, 0, this.accounts.alice)).to.be.revertedWith(
                  'oracle value too old'
                );
                await expect(this.contracts.atm.sell(this.contracts.token, 0, this.accounts.alice)).to.be.revertedWith(
                  'oracle value too old'
                );
              });
            });
          });

        describe('drain', function () {
          it('unauthorized', async function () {
            await expect(
              this.contracts.atm.connect(this.accounts.other).drain(this.contracts.token, this.accounts.alice, 1)
            )
              .to.be.revertedWithCustomError(this.contracts.atm, 'RestrictedAccess')
              .withArgs(
                this.accounts.other,
                this.contracts.atm,
                this.contracts.atm.interface.getFunction('drain').selector
              );
          });

          it('partial', async function () {
            await expect(
              this.contracts.atm.connect(this.accounts.admin).drain(this.contracts.token, this.accounts.alice, 42)
            ).to.changeTokenBalances(this.contracts.token, [this.contracts.atm, this.accounts.alice], [-42, 42]);
          });

          it('total', async function () {
            const balance = await this.contracts.token.balanceOf(this.contracts.atm);
            await expect(
              this.contracts.atm
                .connect(this.accounts.admin)
                .drain(this.contracts.token, this.accounts.alice, ethers.MaxUint256)
            ).to.changeTokenBalances(
              this.contracts.token,
              [this.contracts.atm, this.accounts.alice],
              [-balance, balance]
            );
          });
        });
      });
    }
  });

  describe('ATM v3', function () {
    const oraclettl = time.duration.days(7);

    for (const stableDecimal of [6, 18, 36]) {
      describe(`stable coin with ${stableDecimal} decimals`, function () {
        const formatToken = (value) => ethers.parseUnits(value, 5);
        const formatStable = (value) => ethers.parseUnits(value, stableDecimal);

        beforeEach(async function () {
          /// deployment
          this.contracts.stable = await deploy('ERC20DecimalsMock', [stableDecimal]);
          this.contracts.atm = await deploy('ATM3', [
            this.contracts.oracle.target,
            this.contracts.token.target,
            this.contracts.stable.target,
            this.contracts.manager.target,
            this.contracts.forwarder.target,
            oraclettl,
          ]);

          ///. set atm permissions
          await this.contracts.manager.setRequirements(
            this.contracts.atm,
            [this.contracts.atm.interface.getFunction('drain').selector],
            [this.IDS['operator-exceptional']]
          );
          await this.contracts.manager.addGroup(this.contracts.atm, this.IDS['whitelisted']);

          /// mint and approve
          await this.contracts.token.mint(this.contracts.atm, formatToken('100'));
          await this.contracts.stable.mint(this.contracts.atm, formatStable('100'));
          await this.contracts.token.mint(this.accounts.alice, formatToken('100'));
          await this.contracts.stable.mint(this.accounts.bruce, formatStable('100'));
          await this.contracts.token.connect(this.accounts.alice).approve(this.contracts.atm, ethers.MaxUint256);
          await this.contracts.stable.connect(this.accounts.bruce).approve(this.contracts.atm, ethers.MaxUint256);
        });

        it('post deployment state', async function () {
          expect(await this.contracts.atm.token()).to.equal(this.contracts.token.target);
          expect(await this.contracts.atm.stable()).to.equal(this.contracts.stable.target);
          expect(await this.contracts.atm.oracle()).to.equal(this.contracts.oracle.target);
        });

        for (const { description, oldPrice, newPrice } of [
          {
            description: 'with price increase',
            oldPrice: ethers.parseUnits('2.15467', 6),
            newPrice: ethers.parseUnits('2.17832', 6),
          },
          {
            description: 'with price decrease',
            oldPrice: ethers.parseUnits('2.17832', 6),
            newPrice: ethers.parseUnits('2.15467', 6),
          },
        ])
          describe(description, function () {
            const buyPrice = oldPrice > newPrice ? oldPrice : newPrice;
            const sellPrice = oldPrice < newPrice ? oldPrice : newPrice;
            const numFactor = stableDecimal > 11 ? 10n ** BigInt(stableDecimal - 11) : 1n; // 11 = 5 (decimal of the token) + 6 (price scale)
            const denFactor = stableDecimal < 11 ? 10n ** BigInt(11 - stableDecimal) : 1n; // 11 = 5 (decimal of the token) + 6 (price scale)

            const stableToToken = (amount, price, up = false) =>
              up ? divUp(amount * denFactor, price * numFactor) : (amount * denFactor) / price / numFactor;

            const tokenToStable = (amount, price, up = false) =>
              up ? divUp(amount * numFactor * price, denFactor) : (amount * numFactor * price) / denFactor;

            beforeEach(async function () {
              const timestamp = await time.latest();
              await this.contracts.oracle.publishPrice(timestamp - 3600, oldPrice);
              await this.contracts.oracle.publishPrice(timestamp + 3600, newPrice);
            });

            describe('buy', function () {
              it('preview', async function () {
                expect(await this.contracts.atm.previewBuy(this.contracts.stable, formatStable('1.0'))).to.deep.equal([
                  stableToToken(formatStable('1.0'), buyPrice),
                  formatStable('1.0'),
                ]);
                expect(
                  await this.contracts.atm.previewBuy(this.contracts.stable, formatStable('1.000001'))
                ).to.deep.equal([stableToToken(formatStable('1.000001'), buyPrice), formatStable('1.000001')]); // round down
                expect(await this.contracts.atm.previewBuy(this.contracts.token, formatToken('1.0'))).to.deep.equal([
                  formatToken('1.0'),
                  tokenToStable(formatToken('1.0'), buyPrice, true),
                ]);
                expect(await this.contracts.atm.previewBuy(this.contracts.token, formatToken('1.00001'))).to.deep.equal(
                  [formatToken('1.00001'), tokenToStable(formatToken('1.00001'), buyPrice, true)]
                );
                await expect(this.contracts.atm.previewBuy(this.contracts.manager, 0)).to.be.revertedWith(
                  'invalid input token'
                );
              });

              it('buy (given amount of stable)', async function () {
                const amountStable = formatStable('1.000001');
                const amountToken = stableToToken(amountStable, buyPrice);

                const tx = this.contracts.atm
                  .connect(this.accounts.bruce)
                  .buy(this.contracts.stable, amountStable, this.accounts.alice);
                await expect(tx).to.changeTokenBalances(
                  this.contracts.stable,
                  [this.accounts.bruce, this.contracts.atm],
                  [-amountStable, amountStable]
                );
                await expect(tx).to.changeTokenBalances(
                  this.contracts.token,
                  [this.accounts.alice, this.contracts.atm],
                  [amountToken, -amountToken]
                );
              });

              it('buy (given amount of token)', async function () {
                const amountToken = formatToken('1.00001');
                const amountStable = tokenToStable(amountToken, buyPrice, true);

                const tx = this.contracts.atm
                  .connect(this.accounts.bruce)
                  .buy(this.contracts.token, amountToken, this.accounts.alice);
                await expect(tx).to.changeTokenBalances(
                  this.contracts.stable,
                  [this.accounts.bruce, this.contracts.atm],
                  [-amountStable, amountStable]
                );
                await expect(tx).to.changeTokenBalances(
                  this.contracts.token,
                  [this.accounts.alice, this.contracts.atm],
                  [amountToken, -amountToken]
                );
              });

              it('oracle not updated recently', async function () {
                await time.increase(oraclettl);
                await expect(this.contracts.atm.previewBuy(this.contracts.stable, 0)).to.be.revertedWith(
                  'oracle value too old'
                );
                await expect(this.contracts.atm.previewBuy(this.contracts.token, 0)).to.be.revertedWith(
                  'oracle value too old'
                );
                await expect(this.contracts.atm.buy(this.contracts.stable, 0, this.accounts.alice)).to.be.revertedWith(
                  'oracle value too old'
                );
                await expect(this.contracts.atm.buy(this.contracts.token, 0, this.accounts.alice)).to.be.revertedWith(
                  'oracle value too old'
                );
              });
            });

            describe('sell', function () {
              it('preview', async function () {
                expect(await this.contracts.atm.previewSell(this.contracts.stable, formatStable('1.0'))).to.deep.equal([
                  stableToToken(formatStable('1.0'), sellPrice, true),
                  formatStable('1.0'),
                ]);
                expect(
                  await this.contracts.atm.previewSell(this.contracts.stable, formatStable('1.000001'))
                ).to.deep.equal([stableToToken(formatStable('1.000001'), sellPrice, true), formatStable('1.000001')]); // round down
                expect(await this.contracts.atm.previewSell(this.contracts.token, formatToken('1.0'))).to.deep.equal([
                  formatToken('1.0'),
                  tokenToStable(formatToken('1.0'), sellPrice),
                ]);
                expect(
                  await this.contracts.atm.previewSell(this.contracts.token, formatToken('1.00001'))
                ).to.deep.equal([formatToken('1.00001'), tokenToStable(formatToken('1.00001'), sellPrice)]);
                await expect(this.contracts.atm.previewSell(this.contracts.manager, 0)).to.be.revertedWith(
                  'invalid input token'
                );
              });

              it('sell (given amount of stable)', async function () {
                const amountStable = formatStable('1.000001');
                const amountToken = stableToToken(amountStable, sellPrice, true);

                const tx = this.contracts.atm
                  .connect(this.accounts.alice)
                  .sell(this.contracts.stable, amountStable, this.accounts.bruce);
                await expect(tx).to.changeTokenBalances(
                  this.contracts.stable,
                  [this.accounts.bruce, this.contracts.atm],
                  [amountStable, -amountStable]
                );
                await expect(tx).to.changeTokenBalances(
                  this.contracts.token,
                  [this.accounts.alice, this.contracts.atm],
                  [-amountToken, amountToken]
                );
              });

              it('sell (given amount of token)', async function () {
                const amountToken = formatToken('1.00001');
                const amountStable = tokenToStable(amountToken, sellPrice);

                const tx = this.contracts.atm
                  .connect(this.accounts.alice)
                  .sell(this.contracts.token, amountToken, this.accounts.bruce);
                await expect(tx).to.changeTokenBalances(
                  this.contracts.stable,
                  [this.accounts.bruce, this.contracts.atm],
                  [amountStable, -amountStable]
                );
                await expect(tx).to.changeTokenBalances(
                  this.contracts.token,
                  [this.accounts.alice, this.contracts.atm],
                  [-amountToken, amountToken]
                );
              });

              it('oracle not updated recently', async function () {
                await time.increase(oraclettl);
                await expect(this.contracts.atm.previewSell(this.contracts.stable, 0)).to.be.revertedWith(
                  'oracle value too old'
                );
                await expect(this.contracts.atm.previewSell(this.contracts.token, 0)).to.be.revertedWith(
                  'oracle value too old'
                );
                await expect(this.contracts.atm.sell(this.contracts.stable, 0, this.accounts.alice)).to.be.revertedWith(
                  'oracle value too old'
                );
                await expect(this.contracts.atm.sell(this.contracts.token, 0, this.accounts.alice)).to.be.revertedWith(
                  'oracle value too old'
                );
              });
            });
          });

        describe('drain', function () {
          it('unauthorized', async function () {
            await expect(
              this.contracts.atm.connect(this.accounts.other).drain(this.contracts.token, this.accounts.alice, 1)
            )
              .to.be.revertedWithCustomError(this.contracts.atm, 'RestrictedAccess')
              .withArgs(
                this.accounts.other,
                this.contracts.atm,
                this.contracts.atm.interface.getFunction('drain').selector
              );
          });

          it('partial', async function () {
            await expect(
              this.contracts.atm.connect(this.accounts.admin).drain(this.contracts.token, this.accounts.alice, 42)
            ).to.changeTokenBalances(this.contracts.token, [this.contracts.atm, this.accounts.alice], [-42, 42]);
          });

          it('total', async function () {
            const balance = await this.contracts.token.balanceOf(this.contracts.atm);
            await expect(
              this.contracts.atm
                .connect(this.accounts.admin)
                .drain(this.contracts.token, this.accounts.alice, ethers.MaxUint256)
            ).to.changeTokenBalances(
              this.contracts.token,
              [this.contracts.atm, this.accounts.alice],
              [-balance, balance]
            );
          });
        });
      });
    }
  });

  describe('MultiATM', function () {
    const oraclettl = time.duration.days(7);

    for (const stableDecimal of [6n, 18n, 36n]) {
      const numFactor = 10n ** stableDecimal;
      const denFactor = 10n ** 11n; // 11 = 5 (decimal of the token) + 6 (price scale)

      describe(`stable coin with ${stableDecimal} decimals`, function () {
        const formatToken = (value) => ethers.parseUnits(value, 5);
        const formatStable = (value) => ethers.parseUnits(value, stableDecimal);

        beforeEach(async function () {
          /// deployment
          this.contracts.stable = await deploy('ERC20DecimalsMock', [stableDecimal]);
          this.contracts.atm = await deploy('MultiATM', [
            this.contracts.manager.target,
            this.contracts.forwarder.target,
          ]);

          await this.contracts.manager.setRequirements(
            this.contracts.atm,
            [
              this.contracts.atm.interface.getFunction('swapExactInput').selector,
              this.contracts.atm.interface.getFunction('swapExactInputSingle').selector,
              this.contracts.atm.interface.getFunction('swapExactOutput').selector,
              this.contracts.atm.interface.getFunction('swapExactOutputSingle').selector,
            ],
            [this.IDS['whitelisted']]
          );

          await this.contracts.manager.setRequirements(
            this.contracts.atm,
            [
              this.contracts.atm.interface.getFunction('setPair').selector,
              this.contracts.atm.interface.getFunction('removePair').selector,
              this.contracts.atm.interface.getFunction('withdraw').selector,
            ],
            [this.IDS['operator-exceptional']]
          );
          await this.contracts.manager.addGroup(this.contracts.atm, this.IDS['whitelisted']);

          this.id = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
              ['address', 'address'],
              [this.contracts.token, this.contracts.stable]
                .map(getAddress)
                .sort((a, b) => (ethers.toBigInt(a) > ethers.toBigInt(b) ? 1 : -1))
            )
          );

          await expect(this.contracts.atm.hashPair(this.contracts.token, this.contracts.stable)).to.eventually.equal(
            this.id
          );
          await expect(
            this.contracts.atm.setPair(this.contracts.token, this.contracts.stable, this.contracts.oracle, oraclettl)
          )
            .to.emit(this.contracts.atm, 'PairUpdated')
            .withArgs(this.id, this.contracts.token, this.contracts.stable, this.contracts.oracle, oraclettl);

          /// mint and approve
          await this.contracts.token.mint(this.contracts.atm, formatToken('100'));
          await this.contracts.stable.mint(this.contracts.atm, formatStable('100'));
          await this.contracts.token.mint(this.accounts.alice, formatToken('100'));
          await this.contracts.stable.mint(this.accounts.bruce, formatStable('100'));
          await this.contracts.token.connect(this.accounts.alice).approve(this.contracts.atm, ethers.MaxUint256);
          await this.contracts.stable.connect(this.accounts.bruce).approve(this.contracts.atm, ethers.MaxUint256);
        });

        it('post deployment state', async function () {
          expect(await this.contracts.atm.viewPairDetails(this.contracts.token, this.contracts.stable)).to.deep.equal([
            this.id,
            this.contracts.token.target,
            this.contracts.stable.target,
            this.contracts.oracle.target,
            oraclettl,
            numFactor,
            denFactor,
          ]);
          expect(await this.contracts.atm.viewPairDetails(this.contracts.stable, this.contracts.token)).to.deep.equal([
            this.id,
            this.contracts.token.target,
            this.contracts.stable.target,
            this.contracts.oracle.target,
            oraclettl,
            numFactor,
            denFactor,
          ]);
        });

        for (const { description, oldPrice, newPrice } of [
          {
            description: 'with constant price',
            oldPrice: ethers.parseUnits('2.15467', 6),
            newPrice: ethers.parseUnits('2.15467', 6),
          },
          {
            description: 'with price increase',
            oldPrice: ethers.parseUnits('2.15467', 6),
            newPrice: ethers.parseUnits('2.17832', 6),
          },
          {
            description: 'with price decrease',
            oldPrice: ethers.parseUnits('2.17832', 6),
            newPrice: ethers.parseUnits('2.15467', 6),
          },
        ])
          describe(description, function () {
            const buyPrice = oldPrice > newPrice ? oldPrice : newPrice;
            const sellPrice = oldPrice < newPrice ? oldPrice : newPrice;

            const stableToToken = (amount, price, up = false) =>
              up ? divUp(amount * denFactor, price * numFactor) : (amount * denFactor) / price / numFactor;

            const tokenToStable = (amount, price, up = false) =>
              up ? divUp(amount * numFactor * price, denFactor) : (amount * numFactor * price) / denFactor;

            beforeEach(async function () {
              const timestamp = await time.latest();
              await this.contracts.oracle.publishPrice(timestamp - 3600, oldPrice);
              await this.contracts.oracle.publishPrice(timestamp + 3600, newPrice);
            });

            describe('exact input', function () {
              describe('without fees', function () {
                it('preview single', async function () {
                  await expect(
                    this.contracts.atm.previewExactInputSingle(
                      this.contracts.stable,
                      this.contracts.token,
                      formatStable('1.0')
                    )
                  ).to.eventually.equal(stableToToken(formatStable('1.0'), buyPrice));
                  await expect(
                    this.contracts.atm.previewExactInputSingle(
                      this.contracts.stable,
                      this.contracts.token,
                      formatStable('1.000001')
                    )
                  ).to.eventually.equal(stableToToken(formatStable('1.000001'), buyPrice));
                  await expect(
                    this.contracts.atm.previewExactInputSingle(
                      this.contracts.token,
                      this.contracts.stable,
                      formatToken('1.0')
                    )
                  ).to.eventually.equal(tokenToStable(formatToken('1.0'), sellPrice));
                  await expect(
                    this.contracts.atm.previewExactInputSingle(
                      this.contracts.token,
                      this.contracts.stable,
                      formatToken('1.00001')
                    )
                  ).to.eventually.equal(tokenToStable(formatToken('1.00001'), sellPrice));
                  await expect(
                    this.contracts.atm.previewExactInputSingle(this.contracts.manager, this.contracts.stable, 0)
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'UnknownPair')
                    .withArgs(this.contracts.manager, this.contracts.stable);
                });

                it('preview path', async function () {
                  await expect(
                    this.contracts.atm.previewExactInput(
                      [this.contracts.stable, this.contracts.token],
                      formatStable('1.0')
                    )
                  ).to.eventually.equal(stableToToken(formatStable('1.0'), buyPrice));
                  await expect(
                    this.contracts.atm.previewExactInput(
                      [this.contracts.stable, this.contracts.token],
                      formatStable('1.000001')
                    )
                  ).to.eventually.equal(stableToToken(formatStable('1.000001'), buyPrice));
                  await expect(
                    this.contracts.atm.previewExactInput(
                      [this.contracts.token, this.contracts.stable],
                      formatToken('1.0')
                    )
                  ).to.eventually.equal(tokenToStable(formatToken('1.0'), sellPrice));
                  await expect(
                    this.contracts.atm.previewExactInput(
                      [this.contracts.token, this.contracts.stable],
                      formatToken('1.00001')
                    )
                  ).to.eventually.equal(tokenToStable(formatToken('1.00001'), sellPrice));
                  await expect(this.contracts.atm.previewExactInput([this.contracts.manager, this.contracts.stable], 0))
                    .to.be.revertedWithCustomError(this.contracts.atm, 'UnknownPair')
                    .withArgs(this.contracts.manager, this.contracts.stable);
                });

                it('buy token given exact amount of stable - single', async function () {
                  const amountStable = formatStable('1.000001');
                  const amountToken = stableToToken(amountStable, buyPrice);

                  const tx = this.contracts.atm.connect(this.accounts.bruce).swapExactInputSingle(
                    this.contracts.stable,
                    this.contracts.token,
                    amountStable,
                    this.accounts.alice,
                    0 // no minimum output amount
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.stable,
                    [this.accounts.bruce, this.contracts.atm],
                    [-amountStable, amountStable]
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.token,
                    [this.accounts.alice, this.contracts.atm],
                    [amountToken, -amountToken]
                  );
                });

                it('buy token given exact amount of stable - path', async function () {
                  const amountStable = formatStable('1.000001');
                  const amountToken = stableToToken(amountStable, buyPrice);

                  const tx = this.contracts.atm.connect(this.accounts.bruce).swapExactInput(
                    [this.contracts.stable, this.contracts.token],
                    amountStable,
                    this.accounts.alice,
                    0 // no minimum output amount
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.stable,
                    [this.accounts.bruce, this.contracts.atm],
                    [-amountStable, amountStable]
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.token,
                    [this.accounts.alice, this.contracts.atm],
                    [amountToken, -amountToken]
                  );
                });

                it('buy stable given exact amount of token - single', async function () {
                  const amountToken = formatToken('1.00001');
                  const amountStable = tokenToStable(amountToken, sellPrice);

                  const tx = this.contracts.atm.connect(this.accounts.alice).swapExactInputSingle(
                    this.contracts.token,
                    this.contracts.stable,
                    amountToken,
                    this.accounts.bruce,
                    0 // no minimum output amount
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.token,
                    [this.accounts.alice, this.contracts.atm],
                    [-amountToken, amountToken]
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.stable,
                    [this.accounts.bruce, this.contracts.atm],
                    [amountStable, -amountStable]
                  );
                });

                it('buy stable given exact amount of token - path', async function () {
                  const amountToken = formatToken('1.00001');
                  const amountStable = tokenToStable(amountToken, sellPrice);

                  const tx = this.contracts.atm.connect(this.accounts.alice).swapExactInput(
                    [this.contracts.token, this.contracts.stable],
                    amountToken,
                    this.accounts.bruce,
                    0 // no minimum output amount
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.token,
                    [this.accounts.alice, this.contracts.atm],
                    [-amountToken, amountToken]
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.stable,
                    [this.accounts.bruce, this.contracts.atm],
                    [amountStable, -amountStable]
                  );
                });

                it('oracle not updated recently', async function () {
                  await time.increase(oraclettl);
                  await expect(
                    this.contracts.atm.previewExactInputSingle(this.contracts.stable, this.contracts.token, 0)
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.previewExactInputSingle(this.contracts.token, this.contracts.stable, 0)
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.previewExactInput([this.contracts.stable, this.contracts.token], 0)
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.previewExactInput([this.contracts.token, this.contracts.stable], 0)
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.swapExactInputSingle(
                      this.contracts.stable,
                      this.contracts.token,
                      0,
                      ethers.ZeroAddress,
                      0
                    )
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.swapExactInputSingle(
                      this.contracts.token,
                      this.contracts.stable,
                      0,
                      ethers.ZeroAddress,
                      0
                    )
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.swapExactInput(
                      [this.contracts.stable, this.contracts.token],
                      0,
                      ethers.ZeroAddress,
                      0
                    )
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.swapExactInput(
                      [this.contracts.token, this.contracts.stable],
                      0,
                      ethers.ZeroAddress,
                      0
                    )
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                });

                it('slippage protection', async function () {
                  const inputToken = formatToken('1.00001');
                  const inputStable = formatStable('1.00001');
                  const outputStable = tokenToStable(inputToken, sellPrice);
                  const outputToken = stableToToken(inputStable, buyPrice);

                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactInputSingle(
                        this.contracts.token,
                        this.contracts.stable,
                        inputToken,
                        this.accounts.bruce,
                        outputStable - 1n
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactInputSingle(
                        this.contracts.stable,
                        this.contracts.token,
                        inputStable,
                        this.accounts.alice,
                        outputToken - 1n
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactInput(
                        [this.contracts.token, this.contracts.stable],
                        inputToken,
                        this.accounts.bruce,
                        outputStable - 1n
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactInput(
                        [this.contracts.stable, this.contracts.token],
                        inputStable,
                        this.accounts.alice,
                        outputToken - 1n
                      )
                  ).to.not.be.reverted;

                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactInputSingle(
                        this.contracts.token,
                        this.contracts.stable,
                        inputToken,
                        this.accounts.bruce,
                        outputStable
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactInputSingle(
                        this.contracts.stable,
                        this.contracts.token,
                        inputStable,
                        this.accounts.alice,
                        outputToken
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactInput(
                        [this.contracts.token, this.contracts.stable],
                        inputToken,
                        this.accounts.bruce,
                        outputStable
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactInput(
                        [this.contracts.stable, this.contracts.token],
                        inputStable,
                        this.accounts.alice,
                        outputToken
                      )
                  ).to.not.be.reverted;

                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactInputSingle(
                        this.contracts.token,
                        this.contracts.stable,
                        inputToken,
                        this.accounts.bruce,
                        outputStable + 1n
                      )
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'OutputAmountTooLow')
                    .withArgs(outputStable, outputStable + 1n);
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactInputSingle(
                        this.contracts.stable,
                        this.contracts.token,
                        inputStable,
                        this.accounts.alice,
                        outputToken + 1n
                      )
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'OutputAmountTooLow')
                    .withArgs(outputToken, outputToken + 1n);
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactInput(
                        [this.contracts.token, this.contracts.stable],
                        inputToken,
                        this.accounts.bruce,
                        outputStable + 1n
                      )
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'OutputAmountTooLow')
                    .withArgs(outputStable, outputStable + 1n);
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactInput(
                        [this.contracts.stable, this.contracts.token],
                        inputStable,
                        this.accounts.alice,
                        outputToken + 1n
                      )
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'OutputAmountTooLow')
                    .withArgs(outputToken, outputToken + 1n);
                });
              });

              describe('with fees', function () {
                beforeEach(async function () {
                  await expect(this.contracts.atm.connect(this.accounts.admin).setFee(20n)) // 0.2%
                    .to.emit(this.contracts.atm, 'FeeUpdated')
                    .withArgs(20n);
                });

                it('preview single', async function () {
                  await expect(
                    this.contracts.atm.previewExactInputSingle(
                      this.contracts.stable,
                      this.contracts.token,
                      formatStable('1.0')
                    )
                  ).to.eventually.equal((stableToToken(formatStable('1.0'), buyPrice) * 9980n) / 10000n);
                  await expect(
                    this.contracts.atm.previewExactInputSingle(
                      this.contracts.stable,
                      this.contracts.token,
                      formatStable('1.000001')
                    )
                  ).to.eventually.equal((stableToToken(formatStable('1.000001'), buyPrice) * 9980n) / 10000n);
                  await expect(
                    this.contracts.atm.previewExactInputSingle(
                      this.contracts.token,
                      this.contracts.stable,
                      formatToken('1.0')
                    )
                  ).to.eventually.equal((tokenToStable(formatToken('1.0'), sellPrice) * 9980n) / 10000n);
                  await expect(
                    this.contracts.atm.previewExactInputSingle(
                      this.contracts.token,
                      this.contracts.stable,
                      formatToken('1.00001')
                    )
                  ).to.eventually.equal((tokenToStable(formatToken('1.00001'), sellPrice) * 9980n) / 10000n);
                  await expect(
                    this.contracts.atm.previewExactInputSingle(this.contracts.manager, this.contracts.stable, 0)
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'UnknownPair')
                    .withArgs(this.contracts.manager, this.contracts.stable);
                });

                it('preview path', async function () {
                  await expect(
                    this.contracts.atm.previewExactInput(
                      [this.contracts.stable, this.contracts.token],
                      formatStable('1.0')
                    )
                  ).to.eventually.equal((stableToToken(formatStable('1.0'), buyPrice) * 9980n) / 10000n);
                  await expect(
                    this.contracts.atm.previewExactInput(
                      [this.contracts.stable, this.contracts.token],
                      formatStable('1.000001')
                    )
                  ).to.eventually.equal((stableToToken(formatStable('1.000001'), buyPrice) * 9980n) / 10000n);
                  await expect(
                    this.contracts.atm.previewExactInput(
                      [this.contracts.token, this.contracts.stable],
                      formatToken('1.0')
                    )
                  ).to.eventually.equal((tokenToStable(formatToken('1.0'), sellPrice) * 9980n) / 10000n);
                  await expect(
                    this.contracts.atm.previewExactInput(
                      [this.contracts.token, this.contracts.stable],
                      formatToken('1.00001')
                    )
                  ).to.eventually.equal((tokenToStable(formatToken('1.00001'), sellPrice) * 9980n) / 10000n);
                  await expect(this.contracts.atm.previewExactInput([this.contracts.manager, this.contracts.stable], 0))
                    .to.be.revertedWithCustomError(this.contracts.atm, 'UnknownPair')
                    .withArgs(this.contracts.manager, this.contracts.stable);
                });

                it('buy token given exact amount of stable - single', async function () {
                  const amountStable = formatStable('1.000001');
                  const amountToken = (stableToToken(amountStable, buyPrice) * 9980n) / 10000n;

                  const tx = this.contracts.atm.connect(this.accounts.bruce).swapExactInputSingle(
                    this.contracts.stable,
                    this.contracts.token,
                    amountStable,
                    this.accounts.alice,
                    0 // no minimum output amount
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.stable,
                    [this.accounts.bruce, this.contracts.atm],
                    [-amountStable, amountStable]
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.token,
                    [this.accounts.alice, this.contracts.atm],
                    [amountToken, -amountToken]
                  );
                });

                it('buy token given exact amount of stable - path', async function () {
                  const amountStable = formatStable('1.000001');
                  const amountToken = (stableToToken(amountStable, buyPrice) * 9980n) / 10000n;

                  const tx = this.contracts.atm.connect(this.accounts.bruce).swapExactInput(
                    [this.contracts.stable, this.contracts.token],
                    amountStable,
                    this.accounts.alice,
                    0 // no minimum output amount
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.stable,
                    [this.accounts.bruce, this.contracts.atm],
                    [-amountStable, amountStable]
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.token,
                    [this.accounts.alice, this.contracts.atm],
                    [amountToken, -amountToken]
                  );
                });

                it('buy stable given exact amount of token - single', async function () {
                  const amountToken = formatToken('1.00001');
                  const amountStable = (tokenToStable(amountToken, sellPrice) * 9980n) / 10000n;

                  const tx = this.contracts.atm.connect(this.accounts.alice).swapExactInputSingle(
                    this.contracts.token,
                    this.contracts.stable,
                    amountToken,
                    this.accounts.bruce,
                    0 // no minimum output amount
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.token,
                    [this.accounts.alice, this.contracts.atm],
                    [-amountToken, amountToken]
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.stable,
                    [this.accounts.bruce, this.contracts.atm],
                    [amountStable, -amountStable]
                  );
                });

                it('buy stable given exact amount of token - path', async function () {
                  const amountToken = formatToken('1.00001');
                  const amountStable = (tokenToStable(amountToken, sellPrice) * 9980n) / 10000n;

                  const tx = this.contracts.atm.connect(this.accounts.alice).swapExactInput(
                    [this.contracts.token, this.contracts.stable],
                    amountToken,
                    this.accounts.bruce,
                    0 // no minimum output amount
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.token,
                    [this.accounts.alice, this.contracts.atm],
                    [-amountToken, amountToken]
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.stable,
                    [this.accounts.bruce, this.contracts.atm],
                    [amountStable, -amountStable]
                  );
                });

                it('oracle not updated recently', async function () {
                  await time.increase(oraclettl);
                  await expect(
                    this.contracts.atm.previewExactInputSingle(this.contracts.stable, this.contracts.token, 0)
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.previewExactInputSingle(this.contracts.token, this.contracts.stable, 0)
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.previewExactInput([this.contracts.stable, this.contracts.token], 0)
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.previewExactInput([this.contracts.token, this.contracts.stable], 0)
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.swapExactInputSingle(
                      this.contracts.stable,
                      this.contracts.token,
                      0,
                      ethers.ZeroAddress,
                      0
                    )
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.swapExactInputSingle(
                      this.contracts.token,
                      this.contracts.stable,
                      0,
                      ethers.ZeroAddress,
                      0
                    )
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.swapExactInput(
                      [this.contracts.stable, this.contracts.token],
                      0,
                      ethers.ZeroAddress,
                      0
                    )
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.swapExactInput(
                      [this.contracts.token, this.contracts.stable],
                      0,
                      ethers.ZeroAddress,
                      0
                    )
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                });

                it('slippage protection', async function () {
                  const inputToken = formatToken('1.00001');
                  const inputStable = formatStable('1.00001');
                  const outputStable = (tokenToStable(inputToken, sellPrice) * 9980n) / 10000n;
                  const outputToken = (stableToToken(inputStable, buyPrice) * 9980n) / 10000n;

                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactInputSingle(
                        this.contracts.token,
                        this.contracts.stable,
                        inputToken,
                        this.accounts.bruce,
                        outputStable - 1n
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactInputSingle(
                        this.contracts.stable,
                        this.contracts.token,
                        inputStable,
                        this.accounts.alice,
                        outputToken - 1n
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactInput(
                        [this.contracts.token, this.contracts.stable],
                        inputToken,
                        this.accounts.bruce,
                        outputStable - 1n
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactInput(
                        [this.contracts.stable, this.contracts.token],
                        inputStable,
                        this.accounts.alice,
                        outputToken - 1n
                      )
                  ).to.not.be.reverted;

                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactInputSingle(
                        this.contracts.token,
                        this.contracts.stable,
                        inputToken,
                        this.accounts.bruce,
                        outputStable
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactInputSingle(
                        this.contracts.stable,
                        this.contracts.token,
                        inputStable,
                        this.accounts.alice,
                        outputToken
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactInput(
                        [this.contracts.token, this.contracts.stable],
                        inputToken,
                        this.accounts.bruce,
                        outputStable
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactInput(
                        [this.contracts.stable, this.contracts.token],
                        inputStable,
                        this.accounts.alice,
                        outputToken
                      )
                  ).to.not.be.reverted;

                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactInputSingle(
                        this.contracts.token,
                        this.contracts.stable,
                        inputToken,
                        this.accounts.bruce,
                        outputStable + 1n
                      )
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'OutputAmountTooLow')
                    .withArgs(outputStable, outputStable + 1n);
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactInputSingle(
                        this.contracts.stable,
                        this.contracts.token,
                        inputStable,
                        this.accounts.alice,
                        outputToken + 1n
                      )
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'OutputAmountTooLow')
                    .withArgs(outputToken, outputToken + 1n);
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactInput(
                        [this.contracts.token, this.contracts.stable],
                        inputToken,
                        this.accounts.bruce,
                        outputStable + 1n
                      )
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'OutputAmountTooLow')
                    .withArgs(outputStable, outputStable + 1n);
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactInput(
                        [this.contracts.stable, this.contracts.token],
                        inputStable,
                        this.accounts.alice,
                        outputToken + 1n
                      )
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'OutputAmountTooLow')
                    .withArgs(outputToken, outputToken + 1n);
                });
              });
            });

            describe('exact output', function () {
              describe('without fees', function () {
                it('preview single', async function () {
                  await expect(
                    this.contracts.atm.previewExactOutputSingle(
                      this.contracts.stable,
                      this.contracts.token,
                      formatToken('1.0')
                    )
                  ).to.eventually.equal(tokenToStable(formatToken('1.0'), buyPrice, true));
                  await expect(
                    this.contracts.atm.previewExactOutputSingle(
                      this.contracts.stable,
                      this.contracts.token,
                      formatToken('1.00001')
                    )
                  ).to.eventually.equal(tokenToStable(formatToken('1.00001'), buyPrice, true));
                  await expect(
                    this.contracts.atm.previewExactOutputSingle(
                      this.contracts.token,
                      this.contracts.stable,
                      formatStable('1.0')
                    )
                  ).to.eventually.equal(stableToToken(formatStable('1.0'), sellPrice, true));
                  await expect(
                    this.contracts.atm.previewExactOutputSingle(
                      this.contracts.token,
                      this.contracts.stable,
                      formatStable('1.000001')
                    )
                  ).to.eventually.equal(stableToToken(formatStable('1.000001'), sellPrice, true));
                  await expect(
                    this.contracts.atm.previewExactOutputSingle(this.contracts.manager, this.contracts.stable, 0)
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'UnknownPair')
                    .withArgs(this.contracts.manager, this.contracts.stable);
                });

                it('preview path', async function () {
                  await expect(
                    this.contracts.atm.previewExactOutput(
                      [this.contracts.stable, this.contracts.token],
                      formatToken('1.0')
                    )
                  ).to.eventually.equal(tokenToStable(formatToken('1.0'), buyPrice, true));
                  await expect(
                    this.contracts.atm.previewExactOutput(
                      [this.contracts.stable, this.contracts.token],
                      formatToken('1.00001')
                    )
                  ).to.eventually.equal(tokenToStable(formatToken('1.00001'), buyPrice, true));
                  await expect(
                    this.contracts.atm.previewExactOutput(
                      [this.contracts.token, this.contracts.stable],
                      formatStable('1.0')
                    )
                  ).to.eventually.equal(stableToToken(formatStable('1.0'), sellPrice, true));
                  await expect(
                    this.contracts.atm.previewExactOutput(
                      [this.contracts.token, this.contracts.stable],
                      formatStable('1.000001')
                    )
                  ).to.eventually.equal(stableToToken(formatStable('1.000001'), sellPrice, true));
                  await expect(
                    this.contracts.atm.previewExactOutput([this.contracts.manager, this.contracts.stable], 0)
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'UnknownPair')
                    .withArgs(this.contracts.manager, this.contracts.stable);
                });

                it('buy exact amount of token - single', async function () {
                  const amountToken = formatToken('1.00001');
                  const amountStable = tokenToStable(amountToken, buyPrice, true);

                  const tx = this.contracts.atm.connect(this.accounts.bruce).swapExactOutputSingle(
                    this.contracts.stable,
                    this.contracts.token,
                    amountToken,
                    this.accounts.alice,
                    ethers.MaxUint256 // no maximum input amount
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.stable,
                    [this.accounts.bruce, this.contracts.atm],
                    [-amountStable, amountStable]
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.token,
                    [this.accounts.alice, this.contracts.atm],
                    [amountToken, -amountToken]
                  );
                });

                it('buy exact amount of token - path', async function () {
                  const amountToken = formatToken('1.00001');
                  const amountStable = tokenToStable(amountToken, buyPrice, true);

                  const tx = this.contracts.atm.connect(this.accounts.bruce).swapExactOutput(
                    [this.contracts.stable, this.contracts.token],
                    amountToken,
                    this.accounts.alice,
                    ethers.MaxUint256 // no maximum input amount
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.stable,
                    [this.accounts.bruce, this.contracts.atm],
                    [-amountStable, amountStable]
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.token,
                    [this.accounts.alice, this.contracts.atm],
                    [amountToken, -amountToken]
                  );
                });

                it('buy exact amount of stable - single', async function () {
                  const amountStable = formatStable('1.000001');
                  const amountToken = stableToToken(amountStable, sellPrice, true);

                  const tx = this.contracts.atm.connect(this.accounts.alice).swapExactOutputSingle(
                    this.contracts.token,
                    this.contracts.stable,
                    amountStable,
                    this.accounts.bruce,
                    ethers.MaxUint256 // no maximum input amount
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.token,
                    [this.accounts.alice, this.contracts.atm],
                    [-amountToken, amountToken]
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.stable,
                    [this.accounts.bruce, this.contracts.atm],
                    [amountStable, -amountStable]
                  );
                });

                it('buy exact amount of stable - path', async function () {
                  const amountStable = formatStable('1.000001');
                  const amountToken = stableToToken(amountStable, sellPrice, true);

                  const tx = this.contracts.atm.connect(this.accounts.alice).swapExactOutput(
                    [this.contracts.token, this.contracts.stable],
                    amountStable,
                    this.accounts.bruce,
                    ethers.MaxUint256 // no maximum input amount
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.token,
                    [this.accounts.alice, this.contracts.atm],
                    [-amountToken, amountToken]
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.stable,
                    [this.accounts.bruce, this.contracts.atm],
                    [amountStable, -amountStable]
                  );
                });

                it('oracle not updated recently', async function () {
                  await time.increase(oraclettl);
                  await expect(
                    this.contracts.atm.previewExactOutputSingle(this.contracts.stable, this.contracts.token, 0)
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.previewExactOutputSingle(this.contracts.token, this.contracts.stable, 0)
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.previewExactOutput([this.contracts.stable, this.contracts.token], 0)
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.previewExactOutput([this.contracts.token, this.contracts.stable], 0)
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.swapExactOutputSingle(
                      this.contracts.stable,
                      this.contracts.token,
                      0,
                      ethers.ZeroAddress,
                      ethers.MaxUint256
                    )
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.swapExactOutputSingle(
                      this.contracts.token,
                      this.contracts.stable,
                      0,
                      ethers.ZeroAddress,
                      ethers.MaxUint256
                    )
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.swapExactOutput(
                      [this.contracts.stable, this.contracts.token],
                      0,
                      ethers.ZeroAddress,
                      ethers.MaxUint256
                    )
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.swapExactOutput(
                      [this.contracts.token, this.contracts.stable],
                      0,
                      ethers.ZeroAddress,
                      ethers.MaxUint256
                    )
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                });

                it('slippage protection', async function () {
                  const outputToken = formatToken('1.00001');
                  const outputStable = formatStable('1.000001');
                  const inputStable = tokenToStable(outputToken, buyPrice, true);
                  const inputToken = stableToToken(outputStable, sellPrice, true);

                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactOutputSingle(
                        this.contracts.token,
                        this.contracts.stable,
                        outputStable,
                        this.accounts.bruce,
                        inputToken - 1n
                      )
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'InputAmountTooHigh')
                    .withArgs(inputToken, inputToken - 1n);
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactOutputSingle(
                        this.contracts.stable,
                        this.contracts.token,
                        outputToken,
                        this.accounts.alice,
                        inputStable - 1n
                      )
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'InputAmountTooHigh')
                    .withArgs(inputStable, inputStable - 1n);
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactOutput(
                        [this.contracts.token, this.contracts.stable],
                        outputStable,
                        this.accounts.bruce,
                        inputToken - 1n
                      )
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'InputAmountTooHigh')
                    .withArgs(inputToken, inputToken - 1n);
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactOutput(
                        [this.contracts.stable, this.contracts.token],
                        outputToken,
                        this.accounts.alice,
                        inputStable - 1n
                      )
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'InputAmountTooHigh')
                    .withArgs(inputStable, inputStable - 1n);

                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactOutputSingle(
                        this.contracts.token,
                        this.contracts.stable,
                        outputStable,
                        this.accounts.bruce,
                        inputToken
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactOutputSingle(
                        this.contracts.stable,
                        this.contracts.token,
                        outputToken,
                        this.accounts.alice,
                        inputStable
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactOutput(
                        [this.contracts.token, this.contracts.stable],
                        outputStable,
                        this.accounts.bruce,
                        inputToken
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactOutput(
                        [this.contracts.stable, this.contracts.token],
                        outputToken,
                        this.accounts.alice,
                        inputStable
                      )
                  ).to.not.be.reverted;

                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactOutputSingle(
                        this.contracts.token,
                        this.contracts.stable,
                        outputStable,
                        this.accounts.bruce,
                        inputToken + 1n
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactOutputSingle(
                        this.contracts.stable,
                        this.contracts.token,
                        outputToken,
                        this.accounts.alice,
                        inputStable + 1n
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactOutput(
                        [this.contracts.token, this.contracts.stable],
                        outputStable,
                        this.accounts.bruce,
                        inputToken + 1n
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactOutput(
                        [this.contracts.stable, this.contracts.token],
                        outputToken,
                        this.accounts.alice,
                        inputStable + 1n
                      )
                  ).to.not.be.reverted;
                });
              });

              describe('with fees', function () {
                beforeEach(async function () {
                  await expect(this.contracts.atm.connect(this.accounts.admin).setFee(20n)) // 0.2%
                    .to.emit(this.contracts.atm, 'FeeUpdated')
                    .withArgs(20n);
                });

                it('preview single', async function () {
                  await expect(
                    this.contracts.atm.previewExactOutputSingle(
                      this.contracts.stable,
                      this.contracts.token,
                      formatToken('1.0')
                    )
                  ).to.eventually.equal(divUp(tokenToStable(formatToken('1.0'), buyPrice, true) * 10000n, 9980n));
                  await expect(
                    this.contracts.atm.previewExactOutputSingle(
                      this.contracts.stable,
                      this.contracts.token,
                      formatToken('1.00001')
                    )
                  ).to.eventually.equal(divUp(tokenToStable(formatToken('1.00001'), buyPrice, true) * 10000n, 9980n));
                  await expect(
                    this.contracts.atm.previewExactOutputSingle(
                      this.contracts.token,
                      this.contracts.stable,
                      formatStable('1.0')
                    )
                  ).to.eventually.equal(divUp(stableToToken(formatStable('1.0'), sellPrice, true) * 10000n, 9980n));
                  await expect(
                    this.contracts.atm.previewExactOutputSingle(
                      this.contracts.token,
                      this.contracts.stable,
                      formatStable('1.000001')
                    )
                  ).to.eventually.equal(
                    divUp(stableToToken(formatStable('1.000001'), sellPrice, true) * 10000n, 9980n)
                  );
                  await expect(
                    this.contracts.atm.previewExactOutputSingle(this.contracts.manager, this.contracts.stable, 0)
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'UnknownPair')
                    .withArgs(this.contracts.manager, this.contracts.stable);
                });

                it('preview path', async function () {
                  await expect(
                    this.contracts.atm.previewExactOutput(
                      [this.contracts.stable, this.contracts.token],
                      formatToken('1.0')
                    )
                  ).to.eventually.equal(divUp(tokenToStable(formatToken('1.0'), buyPrice, true) * 10000n, 9980n));
                  await expect(
                    this.contracts.atm.previewExactOutput(
                      [this.contracts.stable, this.contracts.token],
                      formatToken('1.00001')
                    )
                  ).to.eventually.equal(divUp(tokenToStable(formatToken('1.00001'), buyPrice, true) * 10000n, 9980n));
                  await expect(
                    this.contracts.atm.previewExactOutput(
                      [this.contracts.token, this.contracts.stable],
                      formatStable('1.0')
                    )
                  ).to.eventually.equal(divUp(stableToToken(formatStable('1.0'), sellPrice, true) * 10000n, 9980n));
                  await expect(
                    this.contracts.atm.previewExactOutput(
                      [this.contracts.token, this.contracts.stable],
                      formatStable('1.000001')
                    )
                  ).to.eventually.equal(
                    divUp(stableToToken(formatStable('1.000001'), sellPrice, true) * 10000n, 9980n)
                  );
                  await expect(
                    this.contracts.atm.previewExactOutput([this.contracts.manager, this.contracts.stable], 0)
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'UnknownPair')
                    .withArgs(this.contracts.manager, this.contracts.stable);
                });

                it('buy exact amount of token - single', async function () {
                  const amountToken = formatToken('1.00001');
                  const amountStable = divUp(tokenToStable(amountToken, buyPrice, true) * 10000n, 9980n);

                  const tx = this.contracts.atm.connect(this.accounts.bruce).swapExactOutputSingle(
                    this.contracts.stable,
                    this.contracts.token,
                    amountToken,
                    this.accounts.alice,
                    ethers.MaxUint256 // no maximum input amount
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.stable,
                    [this.accounts.bruce, this.contracts.atm],
                    [-amountStable, amountStable]
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.token,
                    [this.accounts.alice, this.contracts.atm],
                    [amountToken, -amountToken]
                  );
                });

                it('buy exact amount of token - path', async function () {
                  const amountToken = formatToken('1.00001');
                  const amountStable = divUp(tokenToStable(amountToken, buyPrice, true) * 10000n, 9980n);

                  const tx = this.contracts.atm.connect(this.accounts.bruce).swapExactOutput(
                    [this.contracts.stable, this.contracts.token],
                    amountToken,
                    this.accounts.alice,
                    ethers.MaxUint256 // no maximum input amount
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.stable,
                    [this.accounts.bruce, this.contracts.atm],
                    [-amountStable, amountStable]
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.token,
                    [this.accounts.alice, this.contracts.atm],
                    [amountToken, -amountToken]
                  );
                });

                it('buy exact amount of stable - single', async function () {
                  const amountStable = formatStable('1.000001');
                  const amountToken = divUp(stableToToken(amountStable, sellPrice, true) * 10000n, 9980n);

                  const tx = this.contracts.atm.connect(this.accounts.alice).swapExactOutputSingle(
                    this.contracts.token,
                    this.contracts.stable,
                    amountStable,
                    this.accounts.bruce,
                    ethers.MaxUint256 // no maximum input amount
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.token,
                    [this.accounts.alice, this.contracts.atm],
                    [-amountToken, amountToken]
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.stable,
                    [this.accounts.bruce, this.contracts.atm],
                    [amountStable, -amountStable]
                  );
                });

                it('buy exact amount of stable - path', async function () {
                  const amountStable = formatStable('1.000001');
                  const amountToken = divUp(stableToToken(amountStable, sellPrice, true) * 10000n, 9980n);

                  const tx = this.contracts.atm.connect(this.accounts.alice).swapExactOutput(
                    [this.contracts.token, this.contracts.stable],
                    amountStable,
                    this.accounts.bruce,
                    ethers.MaxUint256 // no maximum input amount
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.token,
                    [this.accounts.alice, this.contracts.atm],
                    [-amountToken, amountToken]
                  );
                  await expect(tx).to.changeTokenBalances(
                    this.contracts.stable,
                    [this.accounts.bruce, this.contracts.atm],
                    [amountStable, -amountStable]
                  );
                });

                it('oracle not updated recently', async function () {
                  await time.increase(oraclettl);
                  await expect(
                    this.contracts.atm.previewExactOutputSingle(this.contracts.stable, this.contracts.token, 0)
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.previewExactOutputSingle(this.contracts.token, this.contracts.stable, 0)
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.previewExactOutput([this.contracts.stable, this.contracts.token], 0)
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.previewExactOutput([this.contracts.token, this.contracts.stable], 0)
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.swapExactOutputSingle(
                      this.contracts.stable,
                      this.contracts.token,
                      0,
                      ethers.ZeroAddress,
                      ethers.MaxUint256
                    )
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.swapExactOutputSingle(
                      this.contracts.token,
                      this.contracts.stable,
                      0,
                      ethers.ZeroAddress,
                      ethers.MaxUint256
                    )
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.swapExactOutput(
                      [this.contracts.stable, this.contracts.token],
                      0,
                      ethers.ZeroAddress,
                      ethers.MaxUint256
                    )
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                  await expect(
                    this.contracts.atm.swapExactOutput(
                      [this.contracts.token, this.contracts.stable],
                      0,
                      ethers.ZeroAddress,
                      ethers.MaxUint256
                    )
                  ).to.be.revertedWithCustomError(this.contracts.atm, 'OracleValueTooOld');
                });

                it('slippage protection', async function () {
                  const outputToken = formatToken('1.00001');
                  const outputStable = formatStable('1.000001');
                  const inputStable = divUp(tokenToStable(outputToken, buyPrice, true) * 10000n, 9980n);
                  const inputToken = divUp(stableToToken(outputStable, sellPrice, true) * 10000n, 9980n);

                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactOutputSingle(
                        this.contracts.token,
                        this.contracts.stable,
                        outputStable,
                        this.accounts.bruce,
                        inputToken - 1n
                      )
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'InputAmountTooHigh')
                    .withArgs(inputToken, inputToken - 1n);
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactOutputSingle(
                        this.contracts.stable,
                        this.contracts.token,
                        outputToken,
                        this.accounts.alice,
                        inputStable - 1n
                      )
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'InputAmountTooHigh')
                    .withArgs(inputStable, inputStable - 1n);
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactOutput(
                        [this.contracts.token, this.contracts.stable],
                        outputStable,
                        this.accounts.bruce,
                        inputToken - 1n
                      )
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'InputAmountTooHigh')
                    .withArgs(inputToken, inputToken - 1n);
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactOutput(
                        [this.contracts.stable, this.contracts.token],
                        outputToken,
                        this.accounts.alice,
                        inputStable - 1n
                      )
                  )
                    .to.be.revertedWithCustomError(this.contracts.atm, 'InputAmountTooHigh')
                    .withArgs(inputStable, inputStable - 1n);

                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactOutputSingle(
                        this.contracts.token,
                        this.contracts.stable,
                        outputStable,
                        this.accounts.bruce,
                        inputToken
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactOutputSingle(
                        this.contracts.stable,
                        this.contracts.token,
                        outputToken,
                        this.accounts.alice,
                        inputStable
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactOutput(
                        [this.contracts.token, this.contracts.stable],
                        outputStable,
                        this.accounts.bruce,
                        inputToken
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactOutput(
                        [this.contracts.stable, this.contracts.token],
                        outputToken,
                        this.accounts.alice,
                        inputStable
                      )
                  ).to.not.be.reverted;

                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactOutputSingle(
                        this.contracts.token,
                        this.contracts.stable,
                        outputStable,
                        this.accounts.bruce,
                        inputToken + 1n
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactOutputSingle(
                        this.contracts.stable,
                        this.contracts.token,
                        outputToken,
                        this.accounts.alice,
                        inputStable + 1n
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.alice)
                      .swapExactOutput(
                        [this.contracts.token, this.contracts.stable],
                        outputStable,
                        this.accounts.bruce,
                        inputToken + 1n
                      )
                  ).to.not.be.reverted;
                  await expect(
                    this.contracts.atm
                      .connect(this.accounts.bruce)
                      .swapExactOutput(
                        [this.contracts.stable, this.contracts.token],
                        outputToken,
                        this.accounts.alice,
                        inputStable + 1n
                      )
                  ).to.not.be.reverted;
                });
              });
            });

            it('preview path rounding', async function () {
              const amount = ethers.WeiPerEther;

              await expect(
                this.contracts.atm.previewExactInput(
                  [this.contracts.token, this.contracts.stable, this.contracts.token],
                  amount
                )
              ).to.eventually.be.lte(amount);
              await expect(
                this.contracts.atm.previewExactInput(
                  [this.contracts.stable, this.contracts.token, this.contracts.stable],
                  amount
                )
              ).to.eventually.be.lte(amount);
              await expect(
                this.contracts.atm.previewExactOutput(
                  [this.contracts.token, this.contracts.stable, this.contracts.token],
                  amount
                )
              ).to.eventually.be.gte(amount);
              await expect(
                this.contracts.atm.previewExactOutput(
                  [this.contracts.stable, this.contracts.token, this.contracts.stable],
                  amount
                )
              ).to.eventually.be.gte(amount);
            });
          });

        describe('withdraw', function () {
          it('unauthorized', async function () {
            await expect(
              this.contracts.atm.connect(this.accounts.other).withdraw(this.contracts.token, this.accounts.alice, 1)
            )
              .to.be.revertedWithCustomError(this.contracts.atm, 'RestrictedAccess')
              .withArgs(
                this.accounts.other,
                this.contracts.atm,
                this.contracts.atm.interface.getFunction('withdraw').selector
              );
          });

          it('partial', async function () {
            await expect(
              this.contracts.atm.connect(this.accounts.admin).withdraw(this.contracts.token, this.accounts.alice, 42)
            ).to.changeTokenBalances(this.contracts.token, [this.contracts.atm, this.accounts.alice], [-42, 42]);
          });

          it('total', async function () {
            const balance = await this.contracts.token.balanceOf(this.contracts.atm);
            await expect(
              this.contracts.atm
                .connect(this.accounts.admin)
                .withdraw(this.contracts.token, this.accounts.alice, ethers.MaxUint256)
            ).to.changeTokenBalances(
              this.contracts.token,
              [this.contracts.atm, this.accounts.alice],
              [-balance, balance]
            );
          });
        });

        it('setFee above max', async function () {
          await expect(this.contracts.atm.connect(this.accounts.admin).setFee(51n))
            .to.be.revertedWithCustomError(this.contracts.atm, 'InvalidFee')
            .withArgs(51n);
        });
      });
    }
  });

  describe('Permission Manager', function () {
    const { address: caller } = ethers.Wallet.createRandom();
    const { address: target } = ethers.Wallet.createRandom();
    const selector = ethers.hexlify(ethers.randomBytes(4));
    const group = 17;
    const groups = [42, 69];

    describe('canCall', function () {
      describe('simple case: one group', async function () {
        for (const withRequirements of [true, false])
          for (const withPermission of [true, false]) {
            it(
              [
                'Requirements:',
                withRequirements ? 'set' : 'unset',
                '&',
                'Permissions:',
                withPermission ? 'set' : 'unset',
              ].join(' '),
              async function () {
                // set permissions and requirements
                withRequirements && (await this.contracts.manager.setRequirements(target, [selector], [group]));
                withPermission && (await this.contracts.manager.addGroup(caller, group));

                // check can call
                expect(await this.contracts.manager.canCall(caller, target, selector)).to.equal(
                  withRequirements && withPermission
                );
              }
            );
          }
      });

      describe('complexe case: one of many groups', async function () {
        it('some intersection', async function () {
          this.userGroups = [32, 42, 94, 128]; // User has all these groups
          this.targetGroups = [17, 35, 42, 69, 91]; // Target accepts any of these groups
        });

        it('no intersection', async function () {
          this.userGroups = [32, 50, 94, 128]; // User has all these groups
          this.targetGroups = [17, 35, 42, 69, 91]; // Target accepts any of these groups
        });

        afterEach(async function () {
          // set permissions and requirements
          await Promise.all([
            this.contracts.manager.setRequirements(target, [selector], this.targetGroups),
            ...this.userGroups.map((group) => this.contracts.manager.addGroup(caller, group)),
          ]);

          // check can call
          expect(await this.contracts.manager.canCall(caller, target, selector)).to.equal(
            this.userGroups.some((g) => this.targetGroups.includes(g))
          );
        });
      });
    });

    describe('addGroup', function () {
      it('authorized', async function () {
        await expect(this.contracts.manager.connect(this.accounts.admin).addGroup(this.accounts.alice, group))
          .to.emit(this.contracts.manager, 'GroupAdded')
          .withArgs(this.accounts.alice, group);
      });

      it('restricted', async function () {
        await expect(this.contracts.manager.connect(this.accounts.other).addGroup(this.accounts.alice, group))
          .to.revertedWithCustomError(this.contracts.manager, 'MissingPermissions')
          .withArgs(this.accounts.other, this.MASKS.public, this.MASKS.admin);
      });

      it('with role admin', async function () {
        await expect(this.contracts.manager.connect(this.accounts.whitelister).addGroup(this.accounts.alice, group))
          .to.revertedWithCustomError(this.contracts.manager, 'MissingPermissions')
          .withArgs(this.accounts.whitelister, combine(this.MASKS.whitelister, this.MASKS.public), this.MASKS.admin);

        await this.contracts.manager.setGroupAdmins(group, [this.IDS.whitelister]);

        await expect(this.contracts.manager.connect(this.accounts.whitelister).addGroup(this.accounts.alice, group))
          .to.emit(this.contracts.manager, 'GroupAdded')
          .withArgs(this.accounts.alice, group);
      });

      it('effect', async function () {
        expect(await this.contracts.manager.getGroups(this.accounts.alice)).to.equal(
          combine(this.MASKS.public, this.MASKS.whitelisted)
        );

        await expect(this.contracts.manager.connect(this.accounts.admin).addGroup(this.accounts.alice, group))
          .to.emit(this.contracts.manager, 'GroupAdded')
          .withArgs(this.accounts.alice, group);

        expect(await this.contracts.manager.getGroups(this.accounts.alice)).to.equal(
          combine(this.MASKS.public, this.MASKS.whitelisted, toMask(group))
        );
      });
    });

    describe('remGroup', function () {
      beforeEach(async function () {
        await this.contracts.manager.connect(this.accounts.admin).addGroup(this.accounts.alice, group);
      });

      it('authorized', async function () {
        await expect(this.contracts.manager.connect(this.accounts.admin).remGroup(this.accounts.alice, group))
          .to.emit(this.contracts.manager, 'GroupRemoved')
          .withArgs(this.accounts.alice, group);
      });

      it('restricted', async function () {
        await expect(this.contracts.manager.connect(this.accounts.other).remGroup(this.accounts.alice, group))
          .be.revertedWithCustomError(this.contracts.manager, 'MissingPermissions')
          .withArgs(this.accounts.other, this.MASKS.public, this.MASKS.admin);
      });

      it('with role admin', async function () {
        await expect(this.contracts.manager.connect(this.accounts.whitelister).remGroup(this.accounts.alice, group))
          .be.revertedWithCustomError(this.contracts.manager, 'MissingPermissions')
          .withArgs(this.accounts.whitelister, combine(this.MASKS.whitelister, this.MASKS.public), this.MASKS.admin);

        await this.contracts.manager.setGroupAdmins(group, [this.IDS.whitelister]);

        await expect(this.contracts.manager.connect(this.accounts.whitelister).remGroup(this.accounts.alice, group))
          .to.emit(this.contracts.manager, 'GroupRemoved')
          .withArgs(this.accounts.alice, group);
      });

      it('effect', async function () {
        expect(await this.contracts.manager.getGroups(this.accounts.alice)).to.equal(
          combine(this.MASKS.public, this.MASKS.whitelisted, toMask(group))
        );

        await expect(this.contracts.manager.connect(this.accounts.admin).remGroup(this.accounts.alice, group))
          .to.emit(this.contracts.manager, 'GroupRemoved')
          .withArgs(this.accounts.alice, group);

        expect(await this.contracts.manager.getGroups(this.accounts.alice)).to.equal(
          combine(this.MASKS.public, this.MASKS.whitelisted)
        );
      });
    });

    describe('setGroupAdmins', function () {
      it('authorized', async function () {
        await expect(this.contracts.manager.connect(this.accounts.admin).setGroupAdmins(group, groups))
          .to.emit(this.contracts.manager, 'GroupAdmins')
          .withArgs(group, combine(...groups.map(toMask)));
      });

      it('restricted', async function () {
        await expect(this.contracts.manager.connect(this.accounts.other).setGroupAdmins(group, groups))
          .to.revertedWithCustomError(this.contracts.manager, 'MissingPermissions')
          .withArgs(this.accounts.other, this.MASKS.public, this.MASKS.admin);
      });

      it('effect', async function () {
        // Set some previous value
        await this.contracts.manager.connect(this.accounts.admin).setGroupAdmins(group, [group]);

        // Check previous value is set
        expect(await this.contracts.manager.getGroupAdmins(group)).to.equal(combine(this.MASKS.admin, toMask(group)));

        // Set some new values
        await expect(this.contracts.manager.connect(this.accounts.admin).setGroupAdmins(group, groups))
          .to.emit(this.contracts.manager, 'GroupAdmins')
          .withArgs(group, combine(...groups.map(toMask)));

        // Check the new values are set, and the previous is removed
        expect(await this.contracts.manager.getGroupAdmins(group)).to.equal(
          combine(this.MASKS.admin, ...groups.map(toMask))
        );
      });
    });

    describe('setRequirements', function () {
      it('authorized', async function () {
        await expect(this.contracts.manager.connect(this.accounts.admin).setRequirements(target, [selector], groups))
          .to.emit(this.contracts.manager, 'Requirements')
          .withArgs(target, selector, combine(...groups.map(toMask)));
      });

      it('restricted', async function () {
        await expect(this.contracts.manager.connect(this.accounts.other).setRequirements(target, [selector], groups))
          .to.revertedWithCustomError(this.contracts.manager, 'MissingPermissions')
          .withArgs(this.accounts.other, this.MASKS.public, this.MASKS.admin);
      });

      it('effect', async function () {
        // Set some previous value
        await this.contracts.manager.connect(this.accounts.admin).setRequirements(target, [selector], [group]);

        // Check previous value is set
        expect(await this.contracts.manager.getRequirements(target, selector)).to.equal(
          combine(this.MASKS.admin, toMask(group))
        );

        // Set some new values
        await expect(this.contracts.manager.connect(this.accounts.admin).setRequirements(target, [selector], groups))
          .to.emit(this.contracts.manager, 'Requirements')
          .withArgs(target, selector, combine(...groups.map(toMask)));

        // Check the new values are set, and the previous is removed
        expect(await this.contracts.manager.getRequirements(target, selector)).to.equal(
          combine(this.MASKS.admin, ...groups.map(toMask))
        );
      });
    });
  });

  describe('Redemption', function () {
    const output = ethers.Wallet.createRandom();

    beforeEach(async function () {
      // mint tokens
      await this.contracts.token.connect(this.accounts.operator).mint(this.accounts.alice, 1000);

      // set authorized output token
      await this.contracts.redemption.registerOutput(this.contracts.token, output, true);

      // make operation
      this.makeOp = (overrides = {}) => {
        const result = {};
        result.user = overrides?.user ?? this.accounts.alice;
        result.input = overrides?.input ?? this.contracts.token;
        result.output = overrides?.output ?? output;
        result.value = overrides?.value ?? 100;
        result.salt = overrides?.salt ?? ethers.hexlify(ethers.randomBytes(32));
        result.id = ethers.solidityPackedKeccak256(
          ['address', 'address', 'address', 'uint256', 'bytes32'],
          [getAddress(result.user), getAddress(result.input), getAddress(result.output), result.value, result.salt]
        );
        result.data = ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'bytes32'],
          [getAddress(result.output), result.salt]
        );
        return result;
      };
    });

    describe('initiate redemption', function () {
      it('success', async function () {
        const op = this.makeOp();
        expect(await this.contracts.redemption.outputsFor(op.input)).to.include(await op.output.getAddress());

        const { status: statusBefore, deadline: deadlineBefore } = await this.contracts.redemption.details(op.id);
        expect(statusBefore).to.equal(STATUS.NULL);
        expect(deadlineBefore).to.equal(0);

        await expect(
          op.input.connect(op.user).getFunction('transferAndCall(address,uint256,bytes)')(
            this.contracts.redemption,
            op.value,
            op.data
          )
        )
          .to.emit(op.input, 'Transfer')
          .withArgs(op.user, this.contracts.redemption, op.value)
          .to.emit(this.contracts.redemption, 'RedemptionInitiated')
          .withArgs(op.id, op.user, op.input, op.output, op.value, op.salt);

        const timepoint = await time.latest();

        const { status: statusAfter, deadline: deadlineAfter } = await this.contracts.redemption.details(op.id);
        expect(statusAfter).to.equal(STATUS.PENDING);
        expect(deadlineAfter).to.equal(timepoint + time.duration.days(14));
      });

      it('using ERC-2771', async function () {
        const op = this.makeOp();
        expect(await this.contracts.redemption.outputsFor(op.input)).to.include(await op.output.getAddress());

        const { status: statusBefore, deadline: deadlineBefore } = await this.contracts.redemption.details(op.id);
        expect(statusBefore).to.equal(STATUS.NULL);
        expect(deadlineBefore).to.equal(0);

        const request = {
          from: await op.user.getAddress(),
          to: await op.input.getAddress(),
          value: 0n,
          gas: 150_000n, // Could be estimated more accuratelly. 150k should be enough.
          deadline: 2n ** 48n - 1n, // Never
          data: op.input.interface.encodeFunctionData('transferAndCall(address,uint256,bytes)', [
            this.contracts.redemption.target,
            op.value,
            op.data,
          ]),
          nonce: await this.contracts.forwarder.nonces(op.user),
        };
        request.signature = await getDomain(this.contracts.forwarder).then((domain) =>
          op.user.signTypedData(
            domain,
            {
              ForwardRequest: Object.entries({
                from: 'address',
                to: 'address',
                value: 'uint256',
                gas: 'uint256',
                nonce: 'uint256',
                deadline: 'uint48',
                data: 'bytes',
              }).map(([name, type]) => ({ name, type })),
            },
            request
          )
        );

        await expect(this.contracts.forwarder.connect(this.accounts.other).execute(request))
          .to.emit(this.contracts.forwarder, 'ExecutedForwardRequest')
          .withArgs(op.user, request.nonce, true)
          .to.emit(op.input, 'Transfer')
          .withArgs(op.user, this.contracts.redemption, op.value)
          .to.emit(this.contracts.redemption, 'RedemptionInitiated')
          .withArgs(op.id, op.user, op.input, op.output, op.value, op.salt);

        const timepoint = await time.latest();

        const { status: statusAfter, deadline: deadlineAfter } = await this.contracts.redemption.details(op.id);
        expect(statusAfter).to.equal(STATUS.PENDING);
        expect(deadlineAfter).to.equal(timepoint + time.duration.days(14));
      });

      it('duplicated id', async function () {
        const op = this.makeOp();

        // first call is ok
        await op.input.connect(op.user).getFunction('transferAndCall(address,uint256,bytes)')(
          this.contracts.redemption,
          op.value,
          op.data
        );

        // reusing the same operation details with the same salt is not ok
        await expect(
          op.input.connect(op.user).getFunction('transferAndCall(address,uint256,bytes)')(
            this.contracts.redemption,
            op.value,
            op.data
          )
        ).to.be.revertedWith('ID already used');
      });

      it('unauthorized output', async function () {
        const op = this.makeOp({ output: this.accounts.other });

        await expect(
          op.input.connect(op.user).getFunction('transferAndCall(address,uint256,bytes)')(
            this.contracts.redemption,
            op.value,
            op.data
          )
        ).to.be.revertedWith('Input/Output pair is not authorized');
      });

      it('direct call to onTransferReceived', async function () {
        const op = this.makeOp({ input: this.accounts.alice });

        await expect(
          this.contracts.redemption.connect(op.user).onTransferReceived(op.user, op.user, op.value, op.data)
        ).to.be.revertedWith('Input/Output pair is not authorized');
      });

      describe('minimum amount', function () {
        it('just enough', async function () {
          const op = this.makeOp();

          await this.contracts.redemption.connect(this.accounts.admin).setMinimum(this.contracts.token, op.value);

          await expect(
            op.input.connect(op.user).getFunction('transferAndCall(address,uint256,bytes)')(
              this.contracts.redemption,
              op.value,
              op.data
            )
          )
            .to.emit(op.input, 'Transfer')
            .withArgs(op.user, this.contracts.redemption, op.value)
            .to.emit(this.contracts.redemption, 'RedemptionInitiated')
            .withArgs(op.id, op.user, op.input, op.output, op.value, op.salt);
        });

        it('not enough', async function () {
          const op = this.makeOp();

          await this.contracts.redemption.connect(this.accounts.admin).setMinimum(this.contracts.token, op.value + 1);

          await expect(
            op.input.connect(op.user).getFunction('transferAndCall(address,uint256,bytes)')(
              this.contracts.redemption,
              op.value,
              op.data
            )
          ).to.be.rejectedWith('Minimum redemption amount  not reached');
        });
      });
    });

    describe('execute redemption', function () {
      beforeEach(async function () {
        this.operation = this.makeOp();

        await this.operation.input.connect(this.operation.user).getFunction('transferAndCall(address,uint256,bytes)')(
          this.contracts.redemption,
          this.operation.value,
          this.operation.data
        );

        this.operation.deadline = (await time.latest()) + time.duration.days(14);
      });

      it('authorized', async function () {
        const data = ethers.hexlify(ethers.randomBytes(64));

        const { status: statusBefore } = await this.contracts.redemption.details(this.operation.id);
        expect(statusBefore).to.equal(STATUS.PENDING);

        await expect(
          this.contracts.redemption
            .connect(this.accounts.operator)
            .executeRedemption(
              this.operation.user,
              this.operation.input,
              this.operation.output,
              this.operation.value,
              this.operation.salt,
              data
            )
        )
          .to.emit(this.operation.input, 'Transfer')
          .withArgs(this.contracts.redemption, ethers.ZeroAddress, this.operation.value)
          .to.emit(this.contracts.redemption, 'RedemptionExecuted')
          .withArgs(this.operation.id, data);

        const { status: statusAfter } = await this.contracts.redemption.details(this.operation.id);
        expect(statusAfter).to.equal(STATUS.EXECUTED);
      });

      it('unauthorized', async function () {
        const data = ethers.hexlify(ethers.randomBytes(64));

        await expect(
          this.contracts.redemption
            .connect(this.accounts.other)
            .executeRedemption(
              this.operation.user,
              this.operation.input,
              this.operation.output,
              this.operation.value,
              this.operation.salt,
              data
            )
        )
          .to.be.revertedWithCustomError(this.contracts.redemption, 'RestrictedAccess')
          .withArgs(
            this.accounts.other,
            this.contracts.redemption,
            this.contracts.redemption.interface.getFunction('executeRedemption').selector
          );
      });

      it('invalid operation', async function () {
        const data = ethers.hexlify(ethers.randomBytes(64));

        await expect(
          this.contracts.redemption.connect(this.accounts.operator).executeRedemption(
            this.accounts.other, // invalid user
            this.operation.input,
            this.operation.output,
            this.operation.value,
            this.operation.salt,
            data
          )
        ).to.be.revertedWith('Operation is not pending');
      });

      it('too late', async function () {
        const data = ethers.hexlify(ethers.randomBytes(64));

        await time.increase(time.duration.days(15));

        await expect(
          this.contracts.redemption
            .connect(this.accounts.operator)
            .executeRedemption(
              this.operation.user,
              this.operation.input,
              this.operation.output,
              this.operation.value,
              this.operation.salt,
              data
            )
        ).to.be.revertedWith('Deadline passed');
      });
    });

    describe('cancel redemption', function () {
      beforeEach(async function () {
        this.operation = this.makeOp();

        await this.operation.input.connect(this.operation.user).getFunction('transferAndCall(address,uint256,bytes)')(
          this.contracts.redemption,
          this.operation.value,
          this.operation.data
        );

        this.operation.deadline = (await time.latest()) + time.duration.days(7);
      });

      it('anyone can cancel', async function () {
        await time.increase(time.duration.days(15));

        const { status: statusBefore } = await this.contracts.redemption.details(this.operation.id);
        expect(statusBefore).to.equal(STATUS.PENDING);

        await expect(
          this.contracts.redemption
            .connect(this.accounts.other)
            .cancelRedemption(
              this.operation.user,
              this.operation.input,
              this.operation.output,
              this.operation.value,
              this.operation.salt
            )
        )
          .to.emit(this.operation.input, 'Transfer')
          .withArgs(this.contracts.redemption, this.operation.user, this.operation.value)
          .to.emit(this.contracts.redemption, 'RedemptionCanceled')
          .withArgs(this.operation.id);

        const { status: statusAfter } = await this.contracts.redemption.details(this.operation.id);
        expect(statusAfter).to.equal(STATUS.CANCELED);
      });

      it('invalid operation', async function () {
        await time.increase(time.duration.days(10));

        await expect(
          this.contracts.redemption.connect(this.accounts.other).cancelRedemption(
            this.accounts.other, // invalid user
            this.operation.input,
            this.operation.output,
            this.operation.value,
            this.operation.salt
          )
        ).to.be.revertedWith('Operation is not pending');
      });

      it('too late', async function () {
        await expect(
          this.contracts.redemption
            .connect(this.accounts.other)
            .cancelRedemption(
              this.operation.user,
              this.operation.input,
              this.operation.output,
              this.operation.value,
              this.operation.salt
            )
        ).to.be.revertedWith('Deadline not passed');
      });
    });

    describe('admin', function () {
      const other = ethers.Wallet.createRandom();

      describe('enable output', function () {
        it('authorized', async function () {
          expect(await this.contracts.redemption.outputsFor(this.contracts.token)).to.deep.equal(
            [output].map(getAddress)
          );

          await expect(
            this.contracts.redemption.connect(this.accounts.admin).registerOutput(this.contracts.token, other, true)
          )
            .to.emit(this.contracts.redemption, 'EnableOutput')
            .withArgs(this.contracts.token, other, true);

          expect(await this.contracts.redemption.outputsFor(this.contracts.token)).to.deep.equal(
            [output, other].map(getAddress)
          );
        });

        it('unauthorized', async function () {
          expect(await this.contracts.redemption.outputsFor(this.contracts.token)).to.deep.equal(
            [output].map(getAddress)
          );

          await expect(
            this.contracts.redemption.connect(this.accounts.other).registerOutput(this.contracts.token, other, true)
          )
            .to.be.revertedWithCustomError(this.contracts.redemption, 'RestrictedAccess')
            .withArgs(
              this.accounts.other,
              this.contracts.redemption,
              this.contracts.redemption.interface.getFunction('registerOutput').selector
            );

          expect(await this.contracts.redemption.outputsFor(this.contracts.token)).to.deep.equal(
            [output].map(getAddress)
          );
        });

        it('no-effect', async function () {
          expect(await this.contracts.redemption.outputsFor(this.contracts.token)).to.deep.equal(
            [output].map(getAddress)
          );

          await expect(
            this.contracts.redemption.connect(this.accounts.admin).registerOutput(this.contracts.token, output, true)
          )
            .to.emit(this.contracts.redemption, 'EnableOutput')
            .withArgs(this.contracts.token, output, true);

          expect(await this.contracts.redemption.outputsFor(this.contracts.token)).to.deep.equal(
            [output].map(getAddress)
          );
        });
      });

      describe('disable output', function () {
        it('authorized', async function () {
          expect(await this.contracts.redemption.outputsFor(this.contracts.token)).to.deep.equal(
            [output].map(getAddress)
          );

          await expect(
            this.contracts.redemption.connect(this.accounts.admin).registerOutput(this.contracts.token, output, false)
          )
            .to.emit(this.contracts.redemption, 'EnableOutput')
            .withArgs(this.contracts.token, output, false);

          expect(await this.contracts.redemption.outputsFor(this.contracts.token)).to.deep.equal([].map(getAddress));
        });

        it('unauthorized', async function () {
          expect(await this.contracts.redemption.outputsFor(this.contracts.token)).to.deep.equal(
            [output].map(getAddress)
          );

          await expect(
            this.contracts.redemption.connect(this.accounts.other).registerOutput(this.contracts.token, output, false)
          )
            .to.be.revertedWithCustomError(this.contracts.redemption, 'RestrictedAccess')
            .withArgs(
              this.accounts.other,
              this.contracts.redemption,
              this.contracts.redemption.interface.getFunction('registerOutput').selector
            );

          expect(await this.contracts.redemption.outputsFor(this.contracts.token)).to.deep.equal(
            [output].map(getAddress)
          );
        });

        it('no-effect', async function () {
          expect(await this.contracts.redemption.outputsFor(this.contracts.token)).to.deep.equal(
            [output].map(getAddress)
          );

          await expect(
            this.contracts.redemption.connect(this.accounts.admin).registerOutput(this.contracts.token, other, false)
          )
            .to.emit(this.contracts.redemption, 'EnableOutput')
            .withArgs(this.contracts.token, other, false);

          expect(await this.contracts.redemption.outputsFor(this.contracts.token)).to.deep.equal(
            [output].map(getAddress)
          );
        });
      });

      describe('set minimum', function () {
        const amount = ethers.WeiPerEther;

        it('authorized', async function () {
          expect(await this.contracts.redemption.minimum(this.contracts.token)).to.deep.equal(0n);

          await expect(this.contracts.redemption.connect(this.accounts.admin).setMinimum(this.contracts.token, amount))
            .to.emit(this.contracts.redemption, 'MinimumUpdated')
            .withArgs(this.contracts.token, amount);

          expect(await this.contracts.redemption.minimum(this.contracts.token)).to.deep.equal(amount);
        });

        it('unauthorized', async function () {
          expect(await this.contracts.redemption.minimum(this.contracts.token)).to.deep.equal(0n);

          await expect(this.contracts.redemption.connect(this.accounts.other).setMinimum(this.contracts.token, amount))
            .to.be.revertedWithCustomError(this.contracts.redemption, 'RestrictedAccess')
            .withArgs(
              this.accounts.other,
              this.contracts.redemption,
              this.contracts.redemption.interface.getFunction('setMinimum').selector
            );

          expect(await this.contracts.redemption.minimum(this.contracts.token)).to.deep.equal(0n);
        });
      });
    });
  });

  describe('Minter', function () {
    const MINTER_STATUS = Enum('NULL', 'PENDING', 'EXPIRED', 'DONE');

    beforeEach(async function () {
      // Set maxDelay to 1 hour
      await this.contracts.minter.connect(this.accounts.admin).setMaxDelay(3600); // 1 hour in seconds

      // Set daily limit for token
      await this.contracts.minter.connect(this.accounts.admin).setDailyLimit(this.contracts.token, 1000);

      // Helper to make mint operation
      this.makeMintOp = (overrides = {}) => {
        const result = {};
        result.user = overrides?.user ?? this.accounts.alice;
        result.token = overrides?.token ?? this.contracts.token;
        result.amount = overrides?.amount ?? 100;
        result.salt = overrides?.salt ?? ethers.hexlify(ethers.randomBytes(32));
        result.id = ethers.solidityPackedKeccak256(
          ['address', 'address', 'uint256', 'bytes32'],
          [getAddress(result.user), getAddress(result.token), result.amount, result.salt]
        );
        return result;
      };
    });

    describe('helpers', function () {
      it('getCurrentDay', async function () {
        const currentTime = await time.latest();
        const expectedDay = BigInt(currentTime) / 86400n;

        await expect(this.contracts.minter.getCurrentDay()).to.eventually.equal(expectedDay);
      });

      it('hashMintId', async function () {
        const op = this.makeMintOp();

        await expect(this.contracts.minter.hashMintId(op.user, op.token, op.amount, op.salt)).to.eventually.equal(
          ethers.solidityPackedKeccak256(
            ['address', 'address', 'uint256', 'bytes32'],
            [getAddress(op.user), getAddress(op.token), op.amount, op.salt]
          )
        );
      });
    });

    describe('initiateMint', function () {
      it('success - within daily limit', async function () {
        const op = this.makeMintOp({ amount: 500 });

        await expect(this.contracts.minter.mintStateStatus(op.id)).to.eventually.equal(MINTER_STATUS.NULL);
        await expect(this.contracts.minter.getMintedToday(op.token)).to.eventually.equal(0);
        await expect(op.token.balanceOf(op.user)).to.eventually.equal(0);

        await expect(
          this.contracts.minter.connect(this.accounts.operator).initiateMint(op.user, op.token, op.amount, op.salt)
        )
          .to.emit(this.contracts.minter, 'MintExecuted')
          .withArgs(op.id, op.user, op.token, op.amount, op.salt);

        await expect(this.contracts.minter.mintStateStatus(op.id)).to.eventually.equal(MINTER_STATUS.DONE);
        await expect(this.contracts.minter.getMintedToday(op.token)).to.eventually.equal(op.amount);
        await expect(op.token.balanceOf(op.user)).to.eventually.equal(op.amount);
      });

      it('success - exact daily limit', async function () {
        const op = this.makeMintOp({ amount: 1000 });

        await expect(
          this.contracts.minter.connect(this.accounts.operator).initiateMint(op.user, op.token, op.amount, op.salt)
        ).to.emit(this.contracts.minter, 'MintExecuted');

        await expect(this.contracts.minter.mintStateStatus(op.id)).to.eventually.equal(MINTER_STATUS.DONE);
        await expect(this.contracts.minter.getMintedToday(op.token)).to.eventually.equal(1000);
      });

      it('blocks - exceeds daily limit', async function () {
        const op1 = this.makeMintOp({ amount: 600, user: this.accounts.alice });
        const op2 = this.makeMintOp({ amount: 500, user: this.accounts.bruce }); // Total would be 1100 > 1000

        // First mint succeeds
        await this.contracts.minter
          .connect(this.accounts.operator)
          .initiateMint(op1.user, op1.token, op1.amount, op1.salt);

        // Check balance before second mint
        await expect(op2.token.balanceOf(op2.user)).to.eventually.equal(0);

        // Second mint should be blocked
        await expect(
          this.contracts.minter.connect(this.accounts.operator).initiateMint(op2.user, op2.token, op2.amount, op2.salt)
        )
          .to.emit(this.contracts.minter, 'MintBlocked')
          .withArgs(op2.id, op2.user, op2.token, op2.amount, op2.salt);

        await expect(this.contracts.minter.mintStateStatus(op2.id)).to.eventually.equal(MINTER_STATUS.PENDING);

        // Daily usage should only reflect the first mint
        await expect(this.contracts.minter.getMintedToday(op2.token)).to.eventually.equal(600);

        // User should not receive tokens for blocked mint
        await expect(op2.token.balanceOf(op2.user)).to.eventually.equal(0);
      });

      it('blocks - multiple mints accumulate usage', async function () {
        const op1 = this.makeMintOp({ amount: 300 });
        const op2 = this.makeMintOp({ amount: 400 });
        const op3 = this.makeMintOp({ amount: 350 }); // Total would be 1050 > 1000

        // First two mints succeed
        await this.contracts.minter
          .connect(this.accounts.operator)
          .initiateMint(op1.user, op1.token, op1.amount, op1.salt);
        await this.contracts.minter
          .connect(this.accounts.operator)
          .initiateMint(op2.user, op2.token, op2.amount, op2.salt);

        // Third mint should be blocked
        await expect(
          this.contracts.minter.connect(this.accounts.operator).initiateMint(op3.user, op3.token, op3.amount, op3.salt)
        ).to.emit(this.contracts.minter, 'MintBlocked');

        await expect(this.contracts.minter.getMintedToday(op3.token)).to.eventually.equal(700);
      });

      it('reverts - duplicate id', async function () {
        const op = this.makeMintOp();

        // First call succeeds
        await this.contracts.minter.connect(this.accounts.operator).initiateMint(op.user, op.token, op.amount, op.salt);

        // Reusing the same parameters should fail
        await expect(
          this.contracts.minter.connect(this.accounts.operator).initiateMint(op.user, op.token, op.amount, op.salt)
        ).to.be.revertedWith('ID already used');
      });

      it('blocks - daily limit not set', async function () {
        const op = this.makeMintOp();

        // Set daily limit to 0 (effectively not set)
        await this.contracts.minter.connect(this.accounts.admin).setDailyLimit(op.token, 0);

        await expect(
          this.contracts.minter.connect(this.accounts.operator).initiateMint(op.user, op.token, op.amount, op.salt)
        ).to.emit(this.contracts.minter, 'MintBlocked');
      });

      it('reverts - unauthorized caller', async function () {
        const op = this.makeMintOp();

        await expect(
          this.contracts.minter.connect(this.accounts.alice).initiateMint(op.user, op.token, op.amount, op.salt)
        ).to.be.revertedWithCustomError(this.contracts.minter, 'RestrictedAccess');
      });

      it('reverts - zero token address', async function () {
        const op = this.makeMintOp();
        const zeroAddress = ethers.ZeroAddress;

        await expect(
          this.contracts.minter.connect(this.accounts.operator).initiateMint(op.user, zeroAddress, op.amount, op.salt)
        ).to.be.revertedWith('token address must be valid');
      });

      it('reverts - zero amount', async function () {
        const op = this.makeMintOp({ amount: 0 });

        await expect(
          this.contracts.minter.connect(this.accounts.operator).initiateMint(op.user, op.token, op.amount, op.salt)
        ).to.be.revertedWith("The mint amount can't be 0");
      });
    });

    describe('approveMint', function () {
      beforeEach(async function () {
        // Block a mint operation first
        const op = this.makeMintOp({ amount: 600, user: this.accounts.alice });
        await this.contracts.minter.connect(this.accounts.operator).initiateMint(op.user, op.token, op.amount, op.salt);

        // Exceed daily limit to block the next one
        const formatter = this.makeMintOp;
        this.blockedOp = formatter({ amount: 500, user: this.accounts.bruce });
        await this.contracts.minter
          .connect(this.accounts.operator)
          .initiateMint(this.blockedOp.user, this.blockedOp.token, this.blockedOp.amount, this.blockedOp.salt);
      });

      it('success', async function () {
        await expect(this.blockedOp.token.balanceOf(this.blockedOp.user)).to.eventually.equal(0);
        await expect(this.contracts.minter.mintStateStatus(this.blockedOp.id)).to.eventually.equal(
          MINTER_STATUS.PENDING
        );

        await expect(
          this.contracts.minter
            .connect(this.accounts.admin)
            .approveMint(this.blockedOp.user, this.blockedOp.token, this.blockedOp.amount, this.blockedOp.salt)
        )
          .to.emit(this.contracts.minter, 'MintExecuted')
          .withArgs(
            this.blockedOp.id,
            this.blockedOp.user,
            this.blockedOp.token,
            this.blockedOp.amount,
            this.blockedOp.salt
          );

        await expect(this.contracts.minter.mintStateStatus(this.blockedOp.id)).to.eventually.equal(MINTER_STATUS.DONE);
        await expect(this.blockedOp.token.balanceOf(this.blockedOp.user)).to.eventually.equal(this.blockedOp.amount);
      });

      it('reverts - operation not blocked', async function () {
        const op = this.makeMintOp({ amount: 100 });

        await expect(
          this.contracts.minter.connect(this.accounts.admin).approveMint(op.user, op.token, op.amount, op.salt)
        ).to.be.revertedWith('Operation is not pending');
      });

      it('reverts - already executed', async function () {
        // Execute the blocked operation
        await this.contracts.minter
          .connect(this.accounts.admin)
          .approveMint(this.blockedOp.user, this.blockedOp.token, this.blockedOp.amount, this.blockedOp.salt);

        // Try to execute again
        await expect(
          this.contracts.minter
            .connect(this.accounts.admin)
            .approveMint(this.blockedOp.user, this.blockedOp.token, this.blockedOp.amount, this.blockedOp.salt)
        ).to.be.revertedWith('Operation is not pending');
      });

      it('reverts - unauthorized caller', async function () {
        await expect(
          this.contracts.minter
            .connect(this.accounts.alice)
            .approveMint(this.blockedOp.user, this.blockedOp.token, this.blockedOp.amount, this.blockedOp.salt)
        ).to.be.revertedWithCustomError(this.contracts.minter, 'RestrictedAccess');
      });

      it('reverts - zero token address', async function () {
        const zeroAddress = ethers.ZeroAddress;

        await expect(
          this.contracts.minter
            .connect(this.accounts.admin)
            .approveMint(this.blockedOp.user, zeroAddress, this.blockedOp.amount, this.blockedOp.salt)
        ).to.be.revertedWith('token address must be valid');
      });

      it('reverts - zero amount', async function () {
        await expect(
          this.contracts.minter
            .connect(this.accounts.admin)
            .approveMint(this.blockedOp.user, this.blockedOp.token, 0, this.blockedOp.salt)
        ).to.be.revertedWith("The mint amount can't be 0");
      });
    });

    describe('cancelMint', function () {
      beforeEach(async function () {
        // Block a mint operation first
        const op = this.makeMintOp({ amount: 600 });
        await this.contracts.minter.connect(this.accounts.operator).initiateMint(op.user, op.token, op.amount, op.salt);

        // Exceed daily limit to block the next one
        this.blockedOp = this.makeMintOp({ amount: 500 });
        await this.contracts.minter
          .connect(this.accounts.operator)
          .initiateMint(this.blockedOp.user, this.blockedOp.token, this.blockedOp.amount, this.blockedOp.salt);
      });

      it('success', async function () {
        await expect(this.contracts.minter.mintStateStatus(this.blockedOp.id)).to.eventually.equal(
          MINTER_STATUS.PENDING
        );

        await expect(
          this.contracts.minter
            .connect(this.accounts.admin)
            .cancelMint(this.blockedOp.user, this.blockedOp.token, this.blockedOp.amount, this.blockedOp.salt)
        )
          .to.emit(this.contracts.minter, 'MintCanceled')
          .withArgs(this.blockedOp.id);

        await expect(this.contracts.minter.mintStateStatus(this.blockedOp.id)).to.eventually.equal(MINTER_STATUS.DONE);
      });

      it('reverts - operation not blocked', async function () {
        const op = this.makeMintOp({ amount: 100 });

        await expect(
          this.contracts.minter.connect(this.accounts.admin).cancelMint(op.user, op.token, op.amount, op.salt)
        ).to.be.revertedWith('Operation is not active');
      });

      it('reverts - already executed', async function () {
        // Execute the blocked operation first
        await this.contracts.minter
          .connect(this.accounts.admin)
          .approveMint(this.blockedOp.user, this.blockedOp.token, this.blockedOp.amount, this.blockedOp.salt);

        // Try to cancel an executed operation
        await expect(
          this.contracts.minter
            .connect(this.accounts.admin)
            .cancelMint(this.blockedOp.user, this.blockedOp.token, this.blockedOp.amount, this.blockedOp.salt)
        ).to.be.revertedWith('Operation is not active');
      });

      it('reverts - already canceled', async function () {
        // Cancel the blocked operation first
        await this.contracts.minter
          .connect(this.accounts.admin)
          .cancelMint(this.blockedOp.user, this.blockedOp.token, this.blockedOp.amount, this.blockedOp.salt);

        // Try to cancel again
        await expect(
          this.contracts.minter
            .connect(this.accounts.admin)
            .cancelMint(this.blockedOp.user, this.blockedOp.token, this.blockedOp.amount, this.blockedOp.salt)
        ).to.be.revertedWith('Operation is not active');
      });

      it('reverts - unauthorized caller', async function () {
        await expect(
          this.contracts.minter
            .connect(this.accounts.other)
            .cancelMint(this.blockedOp.user, this.blockedOp.token, this.blockedOp.amount, this.blockedOp.salt)
        ).to.be.revertedWithCustomError(this.contracts.minter, 'RestrictedAccess');
      });

      it('reverts - zero token address', async function () {
        const zeroAddress = ethers.ZeroAddress;

        await expect(
          this.contracts.minter
            .connect(this.accounts.admin)
            .cancelMint(this.blockedOp.user, zeroAddress, this.blockedOp.amount, this.blockedOp.salt)
        ).to.be.revertedWith('token address must be valid');
      });

      it('reverts - zero amount', async function () {
        await expect(
          this.contracts.minter
            .connect(this.accounts.admin)
            .cancelMint(this.blockedOp.user, this.blockedOp.token, 0, this.blockedOp.salt)
        ).to.be.revertedWith("The mint amount can't be 0");
      });
    });

    describe('setDailyLimit', function () {
      it('success', async function () {
        const newLimit = 2000;

        await expect(this.contracts.minter.connect(this.accounts.admin).setDailyLimit(this.contracts.token, newLimit))
          .to.emit(this.contracts.minter, 'DailyLimitUpdated')
          .withArgs(this.contracts.token, newLimit);

        await expect(this.contracts.minter.dailyLimit(this.contracts.token)).to.eventually.equal(newLimit);
      });

      it('success - update existing limit', async function () {
        const firstLimit = 1500;
        const secondLimit = 2500;

        await this.contracts.minter.connect(this.accounts.admin).setDailyLimit(this.contracts.token, firstLimit);

        await this.contracts.minter.connect(this.accounts.admin).setDailyLimit(this.contracts.token, secondLimit);

        await expect(this.contracts.minter.dailyLimit(this.contracts.token)).to.eventually.equal(secondLimit);
      });

      it('success - set limit to zero', async function () {
        await this.contracts.minter.connect(this.accounts.admin).setDailyLimit(this.contracts.token, 0);

        await expect(this.contracts.minter.dailyLimit(this.contracts.token)).to.eventually.equal(0);
      });

      it('reverts - unauthorized caller', async function () {
        await expect(
          this.contracts.minter.connect(this.accounts.alice).setDailyLimit(this.contracts.token, 2000)
        ).to.be.revertedWithCustomError(this.contracts.minter, 'RestrictedAccess');
      });
    });

    describe('daily limit behavior', function () {
      it('resets daily usage on new day', async function () {
        const op1 = this.makeMintOp({ amount: 600 });
        const op2 = this.makeMintOp({ amount: 900 });
        expect(op1.token).to.equal(op2.token);

        const firstDay = await this.contracts.minter.getCurrentDay();

        // Use some of the daily limit
        await this.contracts.minter
          .connect(this.accounts.operator)
          .initiateMint(op1.user, op1.token, op1.amount, op1.salt);

        await expect(this.contracts.minter.getMintedToday(op1.token)).to.eventually.equal(600);

        // Advance time by 1 day
        await time.increase(86400);

        await expect(this.contracts.minter.getCurrentDay()).to.eventually.equal(firstDay + 1n);

        // New day should have zero usage
        await expect(this.contracts.minter.getMintedToday(op1.token)).to.eventually.equal(0);

        // Should be able to mint more on the new day
        await expect(
          this.contracts.minter.connect(this.accounts.operator).initiateMint(op2.user, op2.token, op2.amount, op2.salt)
        ).to.emit(this.contracts.minter, 'MintExecuted');

        await expect(this.contracts.minter.getMintedToday(op1.token)).to.eventually.equal(900);
      });

      it('multiple tokens have independent daily limits', async function () {
        // This would require a second token, but we can test with the same token
        // having different limits set, or just verify the mapping works correctly
        const op = this.makeMintOp({ amount: 500 });

        // Set different limit for a different token (mock)
        // In practice, you'd need another deployed token
        await expect(this.contracts.minter.dailyLimit(op.token)).to.eventually.equal(1000);

        // Usage should be tracked per token
        await this.contracts.minter.connect(this.accounts.operator).initiateMint(op.user, op.token, op.amount, op.salt);

        await expect(this.contracts.minter.getMintedToday(op.token)).to.eventually.equal(op.amount);
      });
    });

    describe('maxDelay', function () {
      it('should return maxDelay value', async function () {
        await expect(this.contracts.minter.maxDelay()).to.eventually.equal(3600);
      });

      it('should set deadline correctly when mint is blocked', async function () {
        const op1 = this.makeMintOp({ amount: 600 });
        const op2 = this.makeMintOp({ amount: 500 }); // Total would be 1100 > 1000

        // First mint succeeds
        await this.contracts.minter
          .connect(this.accounts.operator)
          .initiateMint(op1.user, op1.token, op1.amount, op1.salt);

        // Second mint should be blocked
        const tx = await this.contracts.minter
          .connect(this.accounts.operator)
          .initiateMint(op2.user, op2.token, op2.amount, op2.salt);

        // Get the block timestamp from the transaction receipt
        const receipt = await tx.wait();
        const block = await ethers.provider.getBlock(receipt.blockNumber);
        const blockTimestamp = block.timestamp;

        // Check deadline is set to block.timestamp + maxDelay (1 hour)
        const deadline = await this.contracts.minter.mintStateDeadline(op2.id);
        const expectedDeadline = BigInt(blockTimestamp) + 3600n;

        await expect(deadline).to.equal(expectedDeadline);
      });

      it('approveMint should succeed before deadline', async function () {
        const op1 = this.makeMintOp({ amount: 600 });
        const op2 = this.makeMintOp({ amount: 500 });

        // First mint succeeds
        await this.contracts.minter
          .connect(this.accounts.operator)
          .initiateMint(op1.user, op1.token, op1.amount, op1.salt);

        // Second mint gets blocked
        await this.contracts.minter
          .connect(this.accounts.operator)
          .initiateMint(op2.user, op2.token, op2.amount, op2.salt);

        // Verify it's blocked
        await expect(this.contracts.minter.mintStateStatus(op2.id)).to.eventually.equal(MINTER_STATUS.PENDING);

        // Should be able to approve before deadline passes
        await expect(
          this.contracts.minter.connect(this.accounts.admin).approveMint(op2.user, op2.token, op2.amount, op2.salt)
        )
          .to.emit(this.contracts.minter, 'MintExecuted')
          .withArgs(op2.id, op2.user, op2.token, op2.amount, op2.salt);

        await expect(this.contracts.minter.mintStateStatus(op2.id)).to.eventually.equal(MINTER_STATUS.DONE);
      });

      it('approveMint should fail after deadline passes', async function () {
        const op1 = this.makeMintOp({ amount: 600 });
        const op2 = this.makeMintOp({ amount: 500 });

        // First mint succeeds
        await this.contracts.minter
          .connect(this.accounts.operator)
          .initiateMint(op1.user, op1.token, op1.amount, op1.salt);

        // Second mint gets blocked
        await this.contracts.minter
          .connect(this.accounts.operator)
          .initiateMint(op2.user, op2.token, op2.amount, op2.salt);

        // Verify it's blocked
        await expect(this.contracts.minter.mintStateStatus(op2.id)).to.eventually.equal(MINTER_STATUS.PENDING);

        // Advance time by more than 1 hour (maxDelay)
        await time.increase(3601); // 1 hour + 1 second

        // Verify it's blocked
        await expect(this.contracts.minter.mintStateStatus(op2.id)).to.eventually.equal(MINTER_STATUS.EXPIRED);

        // Should fail to approve after deadline
        await expect(
          this.contracts.minter.connect(this.accounts.admin).approveMint(op2.user, op2.token, op2.amount, op2.salt)
        ).to.be.revertedWith('Operation is not pending');
      });

      it('setMaxDelay should update maxDelay value', async function () {
        const newMaxDelay = 7200; // 2 hours

        await expect(this.contracts.minter.connect(this.accounts.admin).setMaxDelay(newMaxDelay))
          .to.emit(this.contracts.minter, 'MaxDelayUpdated')
          .withArgs(newMaxDelay);

        await expect(this.contracts.minter.maxDelay()).to.eventually.equal(newMaxDelay);
      });

      it('setMaxDelay should use new value for blocked mints', async function () {
        // Set maxDelay to 30 minutes
        await this.contracts.minter.connect(this.accounts.admin).setMaxDelay(1800); // 30 minutes

        const op1 = this.makeMintOp({ amount: 600 });
        const op2 = this.makeMintOp({ amount: 500 });

        // First mint succeeds
        await this.contracts.minter
          .connect(this.accounts.operator)
          .initiateMint(op1.user, op1.token, op1.amount, op1.salt);

        // Second mint gets blocked with new maxDelay
        const tx = await this.contracts.minter
          .connect(this.accounts.operator)
          .initiateMint(op2.user, op2.token, op2.amount, op2.salt);

        // Get the block timestamp from the transaction receipt
        const receipt = await tx.wait();
        const block = await ethers.provider.getBlock(receipt.blockNumber);
        const blockTimestamp = block.timestamp;

        // Check deadline is set to block.timestamp + new maxDelay (30 minutes)
        const deadline = await this.contracts.minter.mintStateDeadline(op2.id);
        const expectedDeadline = BigInt(blockTimestamp) + 1800n;

        await expect(deadline).to.equal(expectedDeadline);
      });

      it('setMaxDelay should revert for unauthorized caller', async function () {
        await expect(
          this.contracts.minter.connect(this.accounts.alice).setMaxDelay(7200)
        ).to.be.revertedWithCustomError(this.contracts.minter, 'RestrictedAccess');
      });
    });
  });

  describe('Upgradeability', function () {
    describe('re-initialize', function () {
      it('manager', async function () {
        await expect(this.contracts.manager.initialize(this.accounts.admin)).to.be.revertedWithCustomError(
          this.contracts.manager,
          'InvalidInitialization'
        );
      });

      it('token', async function () {
        await expect(this.contracts.token.initialize('Other Name', 'Other Symbol', 18)).to.be.revertedWithCustomError(
          this.contracts.token,
          'InvalidInitialization'
        );
      });

      it('oracle', async function () {
        await expect(this.contracts.oracle.initialize(this.contracts.token, 18, 'EUR')).to.be.revertedWithCustomError(
          this.contracts.oracle,
          'InvalidInitialization'
        );
      });

      // Redemption doesn't have an initializer
    });

    describe('upgrade', function () {
      // Note: since 5.0.0, upgradeTo is no longer available. We need to force the plugin to use upgradeToAndCall.
      // This is done by using a call. Unfortunatelly, the current version of the plugin doesn't allow us to provide
      // and empty call, because the call is encoded by the plugin. We use a view/pure function to trick the plugin
      // into executing upgradeToAndCall with something that has no effect.

      describe('manager', async function () {
        it('authorized', async function () {
          await ethers.getContractFactory('PermissionManager', this.accounts.admin).then((factory) =>
            upgrades.upgradeProxy(this.contracts.manager, factory, {
              redeployImplementation: 'always',
            })
          );
        });

        it('unauthorized', async function () {
          await expect(
            ethers.getContractFactory('PermissionManager', this.accounts.other).then((factory) =>
              upgrades.upgradeProxy(this.contracts.manager, factory, {
                redeployImplementation: 'always',
              })
            )
          )
            .to.be.revertedWithCustomError(this.contracts.manager, 'MissingPermissions')
            .withArgs(this.accounts.other, this.MASKS.public, this.MASKS.admin);
        });
      });

      describe('token', async function () {
        it('authorized', async function () {
          await ethers.getContractFactory('Token', this.accounts.admin).then((factory) =>
            upgrades.upgradeProxy(this.contracts.token, factory, {
              redeployImplementation: 'always',
              constructorArgs: [this.contracts.manager.target, this.contracts.forwarder.target],
            })
          );
        });

        it('unauthorized', async function () {
          await expect(
            ethers.getContractFactory('Token', this.accounts.other).then((factory) =>
              upgrades.upgradeProxy(this.contracts.token, factory, {
                redeployImplementation: 'always',
                constructorArgs: [this.contracts.manager.target, this.contracts.forwarder.target],
              })
            )
          )
            .to.be.revertedWithCustomError(this.contracts.token, 'RestrictedAccess')
            .withArgs(
              this.accounts.other,
              this.contracts.token,
              this.contracts.token.interface.getFunction('upgradeToAndCall').selector
            );
        });
      });

      describe('oracle', async function () {
        it('authorized', async function () {
          await ethers.getContractFactory('Oracle', this.accounts.admin).then((factory) =>
            upgrades.upgradeProxy(this.contracts.oracle, factory, {
              redeployImplementation: 'always',
              constructorArgs: [this.contracts.manager.target],
            })
          );
        });

        it('unauthorized', async function () {
          await expect(
            ethers.getContractFactory('Oracle', this.accounts.other).then((factory) =>
              upgrades.upgradeProxy(this.contracts.oracle, factory, {
                redeployImplementation: 'always',
                constructorArgs: [this.contracts.manager.target],
              })
            )
          )
            .to.be.revertedWithCustomError(this.contracts.oracle, 'RestrictedAccess')
            .withArgs(
              this.accounts.other,
              this.contracts.oracle,
              this.contracts.oracle.interface.getFunction('upgradeToAndCall').selector
            );
        });
      });

      describe('redemption', async function () {
        it('authorized', async function () {
          await ethers.getContractFactory('Redemption', this.accounts.admin).then((factory) =>
            upgrades.upgradeProxy(this.contracts.redemption, factory, {
              redeployImplementation: 'always',
              constructorArgs: [this.contracts.manager.target],
            })
          );
        });

        it('unauthorized', async function () {
          await expect(
            ethers.getContractFactory('Redemption', this.accounts.other).then((factory) =>
              upgrades.upgradeProxy(this.contracts.redemption, factory, {
                redeployImplementation: 'always',
                constructorArgs: [this.contracts.manager.target],
              })
            )
          )
            .to.be.revertedWithCustomError(this.contracts.redemption, 'RestrictedAccess')
            .withArgs(
              this.accounts.other,
              this.contracts.redemption,
              this.contracts.redemption.interface.getFunction('upgradeToAndCall').selector
            );
        });
      });

      describe('minter', async function () {
        it('authorized', async function () {
          await ethers.getContractFactory('Minter', this.accounts.admin).then((factory) =>
            upgrades.upgradeProxy(this.contracts.minter, factory, {
              redeployImplementation: 'always',
              constructorArgs: [this.contracts.manager.target],
            })
          );
        });

        it('unauthorized', async function () {
          await expect(
            ethers.getContractFactory('Minter', this.accounts.other).then((factory) =>
              upgrades.upgradeProxy(this.contracts.minter, factory, {
                redeployImplementation: 'always',
                constructorArgs: [this.contracts.manager.target],
              })
            )
          )
            .to.be.revertedWithCustomError(this.contracts.minter, 'RestrictedAccess')
            .withArgs(
              this.accounts.other,
              this.contracts.minter,
              this.contracts.minter.interface.getFunction('upgradeToAndCall').selector
            );
        });
      });
    });
  });
});
