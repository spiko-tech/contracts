// Differential test: random call sequences run on the deployed contracts and on the Lean model (lean/DiffTest.lean),
// compared step by step (result, revert reason, balances, daily limit, pair).
// Run: (cd lean && lake build) && LEAN_DIFFTEST=lean/.lake/build/bin/difftest npx hardhat test test/instantRedemption.difftest.js
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');
const { deploy } = require('@amxx/hre/scripts');
const { execFileSync } = require('child_process');
const { fixture, getAddress } = require('./fixtures');

const BIN = process.env.LEAN_DIFFTEST;
const RUNS = Number(process.env.DIFFTEST_RUNS ?? 50);
const STEPS = Number(process.env.DIFFTEST_STEPS ?? 60);
const SEED = Number(process.env.DIFFTEST_SEED ?? 1);
const MAX = ethers.MaxUint256;
const HOUR = 3600n;
const DAY = 86400n;

// mulberry32: deterministic, so a failing seed can be replayed.
const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

(BIN ? describe : describe.skip)('InstantRedemption differential test (Lean model)', function () {
  this.timeout(0);

  for (let run = 0; run < RUNS; run++)
    it(`sequence ${SEED + run}`, async function () {
      const { accounts, contracts } = await loadFixture(fixture);
      const { instantRedemption: ir, redemption, token, oracle } = contracts;
      const stable = await deploy('ERC20DecimalsMock', [6n]);
      const rand = rng(SEED + run);
      const int = (n) => BigInt(Math.floor(rand() * Number(n)));
      const pick = (xs) => xs[Math.floor(rand() * xs.length)];

      // Index 0 is the zero address; the order matches lean/DiffTest.lean.
      const named = [ethers.ZeroAddress, ir, redemption, token, stable, oracle];
      const signers = [accounts.admin, accounts.redeemer, accounts.alice, accounts.other];
      const index = Object.fromEntries([...named, ...signers].map((a, i) => [getAddress(a).toLowerCase(), BigInt(i)]));
      const idx = (a) => index[getAddress(a).toLowerCase()];
      const holders = named.slice(1, 3).concat(signers);

      const snapshot = async () => {
        const bals = [];
        for (const t of [token, stable]) for (const h of holders) bals.push(await t.balanceOf(h));
        const pair = await ir.viewPair(token, stable);
        const limit = await ir.dailyLimit(token, stable, accounts.redeemer);
        const allowance = await token.allowance(accounts.redeemer, ir);
        return [...bals, limit, idx(pair.oracle), ...pair.slice(1), allowance].join(' ');
      };

      const selectors = Object.fromEntries(
        ['redeem', 'setPair', 'removePair', 'setDailyLimit', 'withdraw'].map((f) => [
          ir.interface.getFunction(f).selector,
          f,
        ])
      );
      // Same rendering as `render` in lean/DiffTest.lean. Errors from other contracts are just "external".
      const render = (data) => {
        if (data?.startsWith('0x4e487b71')) return `Panic(${BigInt('0x' + data.slice(10))})`;
        const err = data && data !== '0x' ? ir.interface.parseError(data) : null;
        if (!err || err.name === 'Error') return 'external';
        const a = err.args;
        switch (err.name) {
          case 'RestrictedAccess':
            return `RestrictedAccess(${idx(a[0])},${idx(a[1])},${selectors[a[2]]})`;
          case 'UnknownPair':
          case 'OracleTokenMismatch':
            return `${err.name}(${idx(a[0])},${idx(a[1])})`;
          case 'OracleValueTooOld':
            return `${err.name}(${idx(a[0])})`;
          case 'DailyLimitExceeded':
            return `${err.name}(${idx(a[0])},${a[1]},${a[2]})`;
          default:
            return `${err.name}(${a.join(',')})`;
        }
      };

      let now = BigInt(await time.latest());
      const lines = [
        'config ' + [await token.decimals(), 6n, await oracle.decimals(), await redemption.minimum(token)].join(' '),
      ];
      const observed = [];
      const record = async (line, result) => {
        lines.push(line);
        observed.push(`${result} | ${await snapshot()}`);
      };

      // Every transaction gets its own block at a chosen timestamp, which the Lean side receives too.
      const at = async (dt) => {
        now += dt;
        await time.setNextBlockTimestamp(now);
        return now;
      };
      const send = async (signer, fn, args, target) => {
        const ts = await at(target > now ? target - now : pick([1n, 60n, HOUR, 6n * HOUR]) + int(HOUR));
        try {
          const tx = await ir.connect(signer)[fn](...args, { gasLimit: 2_000_000 });
          await tx.wait();
          return { ts, ok: true };
        } catch (e) {
          return { ts, ok: false, data: e.data ?? e.error?.data ?? e.info?.error?.data };
        }
      };

      // Setup, as in test/instantRedemption.test.js.
      await at(1n);
      await redemption.registerOutput(token, stable, true);
      for (const [t, h, v] of [
        [token, accounts.redeemer, 10n ** 9n],
        [stable, ir, 10n ** 10n],
      ]) {
        await at(1n);
        await t.mint(h, v);
        await record(`mint ${idx(t)} ${idx(h)} ${v}`, 'ok');
      }
      await at(1n);
      await token.connect(accounts.redeemer).approve(ir, MAX);
      await record(`approve ${idx(token)} ${idx(accounts.redeemer)} ${idx(ir)} ${MAX}`, 'ok');
      await at(1n);
      await oracle.publishPrice(now, 1032100n);
      let res = await send(accounts.admin, 'setPair', [token, stable, oracle, 7n * DAY]);
      await record(`setPair ${idx(accounts.admin)} ${res.ts} ${idx(token)} ${idx(stable)} ${7n * DAY}`, 'ok');
      res = await send(accounts.admin, 'setDailyLimit', [token, stable, accounts.redeemer, 5n * 10n ** 9n]);
      await record(
        `setDailyLimit ${idx(accounts.admin)} ${res.ts} ${idx(token)} ${idx(stable)} ${idx(accounts.redeemer)} ${5n * 10n ** 9n}`,
        'ok'
      );

      const tokenOrStable = () =>
        rand() < 0.9
          ? [token, stable]
          : pick([
              [stable, token],
              [token, token],
            ]);
      // Mostly the right role for the function, sometimes anyone.
      const sender = (usual) => (rand() < 0.9 ? usual : pick(signers));
      const amount = () =>
        rand() < 0.7
          ? int(10n ** 8n)
          : pick([0n, 1n, int(1000n), int(2n * 10n ** 9n), MAX - int(1000n), 2n ** 205n + int(2n ** 205n)]);

      for (let i = 0; i < STEPS; i++) {
        const r = rand();
        if (r < 0.45) {
          const s = sender(accounts.redeemer);
          const [t, c] = tokenOrStable();
          const value = amount();
          const minOut = pick([0n, 0n, 1n, int(10n ** 8n)]);
          const salt = int(4n);
          const { answer, updatedAt } = await oracle.latestRoundData();
          // Sometimes right at the end of the price's validity (updatedAt + oracleTTL), when that is still ahead.
          const target = rand() < 0.2 ? updatedAt + (await ir.viewPair(token, stable)).oracleTTL - int(2n) : 0n;
          const res = await send(s, 'redeem', [t, c, value, minOut, ethers.toBeHex(salt, 32)], target);
          const out = res.ok
            ? 'ok ' + (await ir.queryFilter(ir.filters.InstantRedemptionExecuted(), 'latest'))[0].args[5]
            : render(res.data);
          await record(
            `redeem ${idx(s)} ${res.ts} ${answer} ${updatedAt} ${idx(t)} ${idx(c)} ${value} ${minOut} ${salt}`,
            out
          );
        } else if (r < 0.52) {
          const s = sender(accounts.admin);
          const [t, c] = tokenOrStable();
          const ttl = rand() < 0.8 ? 7n * DAY : pick([0n, HOUR, DAY, int(2n ** 48n)]);
          const res = await send(s, 'setPair', [t, c, oracle, ttl]);
          await record(`setPair ${idx(s)} ${res.ts} ${idx(t)} ${idx(c)} ${ttl}`, res.ok ? 'ok' : render(res.data));
        } else if (r < 0.55) {
          const s = sender(accounts.admin);
          const [t, c] = tokenOrStable();
          const res = await send(s, 'removePair', [t, c]);
          await record(`removePair ${idx(s)} ${res.ts} ${idx(t)} ${idx(c)}`, res.ok ? 'ok' : render(res.data));
        } else if (r < 0.72) {
          const s = sender(accounts.admin);
          const [t, c] = tokenOrStable();
          const user = pick([accounts.redeemer, accounts.redeemer, accounts.alice]);
          const limit = pick([0n, int(10n ** 9n), int(10n ** 11n), MAX, 2n ** 208n + int(2n ** 208n)]);
          const res = await send(s, 'setDailyLimit', [t, c, user, limit]);
          await record(
            `setDailyLimit ${idx(s)} ${res.ts} ${idx(t)} ${idx(c)} ${idx(user)} ${limit}`,
            res.ok ? 'ok' : render(res.data)
          );
        } else if (r < 0.78) {
          const s = sender(accounts.admin);
          const t = pick([token, stable]);
          const to = pick([ethers.ZeroAddress, accounts.alice, accounts.other, accounts.redeemer]);
          const value = pick([MAX, int(10n ** 8n), int(10n ** 10n)]);
          const res = await send(s, 'withdraw', [t, to, value]);
          await record(`withdraw ${idx(s)} ${res.ts} ${idx(t)} ${idx(to)} ${value}`, res.ok ? 'ok' : render(res.data));
        } else if (r < 0.9) {
          // New oracle round, possibly in the future (prices are published for a past or future timepoint).
          const { updatedAt } = await oracle.latestRoundData();
          await at(1n);
          const timepoint = updatedAt + int(now - updatedAt + 2n * HOUR);
          await oracle.publishPrice(timepoint, pick([0n, 1000000n + int(100000n), int(2n ** 64n)]));
        } else if (r < 0.95) {
          const allowance = pick([MAX, 0n, int(10n ** 9n)]);
          await at(1n);
          await token.connect(accounts.redeemer).approve(ir, allowance);
          await record(`approve ${idx(token)} ${idx(accounts.redeemer)} ${idx(ir)} ${allowance}`, 'ok');
        } else {
          await at(pick([DAY, 7n * DAY]));
          await ethers.provider.send('evm_mine');
        }
      }

      const expected = execFileSync(BIN, { input: lines.join('\n') + '\n' })
        .toString()
        .trim()
        .split('\n');
      for (let i = 0; i < observed.length; i++) expect(expected[i], `step ${i}: ${lines[i + 1]}`).to.equal(observed[i]);
      expect(expected.length).to.equal(observed.length);
    });
});
