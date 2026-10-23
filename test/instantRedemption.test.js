const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');
const { deploy } = require('@amxx/hre/scripts');
const { Enum, combine } = require('./helpers');
const { fixture, getAddress } = require('./fixtures');

const STATUS = Enum('NULL', 'PENDING', 'EXECUTED', 'CANCELED');

const stableDecimals = 6n;
const numFactor = 10n ** stableDecimals;
const denFactor = 10n ** 11n; // 11 = 5 (decimals of the token) + 6 (decimals of the oracle)
const oracleTTL = time.duration.days(7);

const formatToken = (value) => ethers.parseUnits(value, 5);
const formatStable = (value) => ethers.parseUnits(value, stableDecimals);
const tokenToStable = (amount, price) => (amount * numFactor * price) / denFactor;
const randomSalt = () => ethers.hexlify(ethers.randomBytes(32));

describe('InstantRedemption', function () {
  beforeEach(async function () {
    await loadFixture(fixture).then((results) => Object.assign(this, results));

    this.ir = this.contracts.instantRedemption;
    this.stable = await deploy('ERC20DecimalsMock', [stableDecimals]);
    this.pairId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address'],
        [this.contracts.token, this.stable].map(getAddress)
      )
    );

    // configuration
    await this.contracts.redemption.registerOutput(this.contracts.token, this.stable, true);
    await this.ir.setPair(this.contracts.token, this.stable, this.contracts.oracle, oracleTTL);
    await this.ir.setDailyLimit(this.contracts.token, this.stable, this.accounts.redeemer, formatStable('5000'));

    // buffer and user balance
    await this.stable.mint(this.ir, formatStable('10000'));
    await this.contracts.token.mint(this.accounts.redeemer, formatToken('10000'));
    await this.contracts.token.connect(this.accounts.redeemer).approve(this.ir, ethers.MaxUint256);

    this.redemptionId = (amount, salt) =>
      ethers.solidityPackedKeccak256(
        ['address', 'address', 'address', 'uint256', 'bytes32'],
        [this.ir, this.contracts.token, this.stable, amount, salt].map(getAddress)
      );

    this.redeem = (amount, minOut = 0n, signer = this.accounts.redeemer, salt = randomSalt()) =>
      this.ir.connect(signer).redeem(this.contracts.token, this.stable, amount, minOut, salt);
  });

  it('functions have requirements', async function () {
    const requirements = (fn) =>
      this.contracts.manager.getRequirements(this.ir, this.ir.interface.getFunction(fn).selector);

    await expect(requirements('redeem')).to.eventually.equal(combine(this.MASKS.admin, this.MASKS['instant-redeemer']));
    for (const fn of ['setPair', 'removePair', 'setDailyLimit', 'withdraw', 'upgradeToAndCall']) {
      await expect(requirements(fn)).to.eventually.equal(combine(this.MASKS.admin));
    }
  });

  it('post deployment state', async function () {
    await expect(this.ir.authority()).to.eventually.equal(this.contracts.manager);
    await expect(this.ir.redemption()).to.eventually.equal(this.contracts.redemption);
    await expect(this.ir.hashPair(this.contracts.token, this.stable)).to.eventually.equal(this.pairId);
    await expect(this.ir.dailyLimit(this.contracts.token, this.stable, this.accounts.redeemer)).to.eventually.equal(
      formatStable('5000')
    );
    await expect(this.ir.viewPair(this.contracts.token, this.stable)).to.eventually.deep.equal([
      this.contracts.oracle.target,
      oracleTTL,
      numFactor,
      denFactor,
    ]);
  });

  for (const { description, oldPrice, newPrice } of [
    {
      description: 'with constant price',
      oldPrice: ethers.parseUnits('1.0321', 6),
      newPrice: ethers.parseUnits('1.0321', 6),
    },
    {
      description: 'with price increase',
      oldPrice: ethers.parseUnits('1.0321', 6),
      newPrice: ethers.parseUnits('1.0324', 6),
    },
    {
      description: 'with price decrease',
      oldPrice: ethers.parseUnits('1.0324', 6),
      newPrice: ethers.parseUnits('1.0321', 6),
    },
  ])
    describe(description, function () {
      const amount = formatToken('1000.12345');
      const expected = tokenToStable(amount, newPrice);

      beforeEach(async function () {
        const timestamp = await time.latest();
        await this.contracts.oracle.publishPrice(timestamp - 3600, oldPrice);
        await this.contracts.oracle.publishPrice(timestamp + 3600, newPrice);
      });

      it('preview uses the latest price, rounded down', async function () {
        await expect(this.ir.previewRedeem(this.contracts.token, this.stable, amount)).to.eventually.equal(expected);
      });

      it('success: pays the user and opens a redemption request owned by the contract', async function () {
        const salt = randomSalt();
        const id = this.redemptionId(amount, salt);

        const tx = this.redeem(amount, expected, undefined, salt);
        await expect(tx).to.changeTokenBalances(this.stable, [this.accounts.redeemer, this.ir], [expected, -expected]);
        await expect(tx).to.changeTokenBalances(
          this.contracts.token,
          [this.accounts.redeemer, this.ir, this.contracts.redemption],
          [-amount, 0n, amount]
        );
        await expect(tx)
          .to.emit(this.contracts.redemption, 'RedemptionInitiated')
          .withArgs(id, this.ir, this.contracts.token, this.stable, amount, salt)
          .to.emit(this.ir, 'Redeemed')
          .withArgs(this.pairId, this.accounts.redeemer, this.contracts.token, this.stable, amount, expected, id);

        const { status } = await this.contracts.redemption.details(id);
        expect(status).to.equal(STATUS.PENDING);
        await expect(
          this.ir.remainingDailyLimit(this.contracts.token, this.stable, this.accounts.redeemer)
        ).to.eventually.equal(formatStable('5000') - expected);
      });
    });

  describe('with prices', function () {
    const price = ethers.parseUnits('1.0321', 6);
    const amount = formatToken('1000');
    const expected = tokenToStable(amount, price);

    beforeEach(async function () {
      const timestamp = await time.latest();
      await this.contracts.oracle.publishPrice(timestamp - 3600, price);
      await this.contracts.oracle.publishPrice(timestamp, price);
    });

    it('identical redemptions with distinct salts get distinct request ids', async function () {
      for (const salt of [randomSalt(), randomSalt()]) {
        await expect(this.redeem(amount, 0n, undefined, salt))
          .to.emit(this.ir, 'Redeemed')
          .withArgs(
            this.pairId,
            this.accounts.redeemer,
            this.contracts.token,
            this.stable,
            amount,
            expected,
            this.redemptionId(amount, salt)
          );
      }
    });

    it('reusing a salt reverts (retry protection)', async function () {
      const salt = randomSalt();
      await this.redeem(amount, 0n, undefined, salt);
      await expect(this.redeem(amount, 0n, undefined, salt)).to.be.revertedWith('ID already used');
    });

    describe('reverts', function () {
      it('caller without the instant-redeemer role', async function () {
        await expect(this.redeem(amount, 0n, this.accounts.alice))
          .to.be.revertedWithCustomError(this.ir, 'RestrictedAccess')
          .withArgs(this.accounts.alice, this.ir, this.ir.interface.getFunction('redeem').selector);
      });

      it('unknown pair', async function () {
        await this.ir.removePair(this.contracts.token, this.stable);
        await expect(this.redeem(amount))
          .to.be.revertedWithCustomError(this.ir, 'UnknownPair')
          .withArgs(this.contracts.token, this.stable);
      });

      it('oracle value too old', async function () {
        await time.increase(oracleTTL);
        await expect(this.redeem(amount))
          .to.be.revertedWithCustomError(this.ir, 'OracleValueTooOld')
          .withArgs(this.contracts.oracle);
      });

      it('output below minimum output', async function () {
        await expect(this.redeem(amount, expected + 1n))
          .to.be.revertedWithCustomError(this.ir, 'OutputAmountTooLow')
          .withArgs(expected, expected + 1n);
      });

      it('amount below the Redemption minimum (bubbled up)', async function () {
        await this.contracts.redemption.setMinimum(this.contracts.token, amount + 1n);
        await expect(this.redeem(amount)).to.be.revertedWith('Minimum redemption amount  not reached');
      });

      it('stablecoin not registered as a Redemption output (bubbled up)', async function () {
        await this.contracts.redemption.registerOutput(this.contracts.token, this.stable, false);
        await expect(this.redeem(amount)).to.be.revertedWith('Input/Output pair is not authorized');
      });

      it('buffer too small', async function () {
        await this.ir.withdraw(this.stable, this.accounts.admin, ethers.MaxUint256);
        await expect(this.redeem(amount)).to.be.revertedWithCustomError(this.stable, 'ERC20InsufficientBalance');
      });
    });

    describe('daily limit', function () {
      it('user with the role but no limit', async function () {
        await this.contracts.manager.addGroup(this.accounts.alice, this.IDS['instant-redeemer']);
        await this.contracts.token.mint(this.accounts.alice, amount);
        await this.contracts.token.connect(this.accounts.alice).approve(this.ir, amount);

        await expect(this.redeem(amount, 0n, this.accounts.alice))
          .to.be.revertedWithCustomError(this.ir, 'DailyLimitExceeded')
          .withArgs(this.accounts.alice, expected, 0n);
      });

      it('exact limit passes, one more unit reverts', async function () {
        await this.ir.setDailyLimit(this.contracts.token, this.stable, this.accounts.redeemer, expected);
        await expect(this.redeem(amount)).to.emit(this.ir, 'Redeemed');

        const small = formatToken('0.001');
        await expect(this.redeem(small))
          .to.be.revertedWithCustomError(this.ir, 'DailyLimitExceeded')
          .withArgs(this.accounts.redeemer, tokenToStable(small, price), 0n);
      });

      it('resets on the next day', async function () {
        await this.ir.setDailyLimit(this.contracts.token, this.stable, this.accounts.redeemer, expected);
        await this.redeem(amount);
        await expect(this.redeem(amount)).to.be.revertedWithCustomError(this.ir, 'DailyLimitExceeded');

        await time.increase(time.duration.days(1));
        await expect(
          this.ir.remainingDailyLimit(this.contracts.token, this.stable, this.accounts.redeemer)
        ).to.eventually.equal(expected);
        await expect(this.redeem(amount)).to.emit(this.ir, 'Redeemed');
      });

      it('limit lowered below today usage', async function () {
        await this.redeem(amount);
        await expect(this.ir.setDailyLimit(this.contracts.token, this.stable, this.accounts.redeemer, 1n))
          .to.emit(this.ir, 'DailyLimitUpdated')
          .withArgs(this.pairId, this.accounts.redeemer, this.contracts.token, this.stable, 1n);
        await expect(
          this.ir.remainingDailyLimit(this.contracts.token, this.stable, this.accounts.redeemer)
        ).to.eventually.equal(0n);
      });

      it('is tracked per pair', async function () {
        const other = await deploy('ERC20DecimalsMock', [stableDecimals]);
        await this.ir.setPair(this.contracts.token, other, this.contracts.oracle, oracleTTL);
        await expect(
          this.ir.remainingDailyLimit(this.contracts.token, other, this.accounts.redeemer)
        ).to.eventually.equal(0n);
      });
    });

    describe('settlement', function () {
      beforeEach(async function () {
        const salt = randomSalt();
        await this.redeem(amount, 0n, undefined, salt);
        this.op = [this.ir, this.contracts.token, this.stable, amount, salt];
      });

      it('execution burns the tokens, repayment refills the buffer', async function () {
        await expect(
          this.contracts.redemption.connect(this.accounts.operator).executeRedemption(...this.op, '0x')
        ).to.changeTokenBalance(this.contracts.token, this.contracts.redemption, -amount);

        // off-chain settlement pays the request user, which is the instant redemption contract
        await expect(this.stable.mint(this.ir, expected)).to.changeTokenBalance(this.stable, this.ir, expected);
      });

      it('cancellation refunds the contract, admin recovers the tokens', async function () {
        await time.increase(time.duration.days(14));
        await expect(
          this.contracts.redemption.connect(this.accounts.operator).cancelRedemption(...this.op)
        ).to.changeTokenBalance(this.contracts.token, this.ir, amount);

        await expect(
          this.ir.withdraw(this.contracts.token, this.accounts.alice, ethers.MaxUint256)
        ).to.changeTokenBalances(this.contracts.token, [this.ir, this.accounts.alice], [-amount, amount]);
      });
    });
  });

  describe('admin', function () {
    it('only admin can configure', async function () {
      const other = this.ir.connect(this.accounts.other);
      for (const [fn, args] of [
        ['setPair', [this.contracts.token, this.stable, this.contracts.oracle, oracleTTL]],
        ['removePair', [this.contracts.token, this.stable]],
        ['setDailyLimit', [this.contracts.token, this.stable, this.accounts.other, 1n]],
        ['withdraw', [this.stable, this.accounts.other, 1n]],
      ]) {
        await expect(other[fn](...args))
          .to.be.revertedWithCustomError(this.ir, 'RestrictedAccess')
          .withArgs(this.accounts.other, this.ir, this.ir.interface.getFunction(fn).selector);
      }
    });

    it('removePair', async function () {
      await expect(this.ir.removePair(this.contracts.token, this.stable))
        .to.emit(this.ir, 'PairRemoved')
        .withArgs(this.pairId, this.contracts.token, this.stable);
      await expect(this.ir.viewPair(this.contracts.token, this.stable)).to.eventually.deep.equal([
        ethers.ZeroAddress,
        0n,
        0n,
        0n,
      ]);
    });

    it('withdraw', async function () {
      await expect(this.ir.withdraw(this.stable, this.accounts.admin, formatStable('1'))).to.changeTokenBalances(
        this.stable,
        [this.ir, this.accounts.admin],
        [-formatStable('1'), formatStable('1')]
      );
      await expect(this.ir.withdraw(this.stable, this.accounts.admin, ethers.MaxUint256)).to.changeTokenBalances(
        this.stable,
        [this.ir, this.accounts.admin],
        [-formatStable('9999'), formatStable('9999')]
      );
    });
  });
});
