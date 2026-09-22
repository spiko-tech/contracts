const { expect } = require('chai');
const { ethers } = require('hardhat');
const { migrate } = require('../scripts/migrate');

const getAddress = (account) => account.address ?? account.target ?? account;

async function fixture() {
  const accounts = await ethers.getSigners();
  accounts.admin = accounts.shift();
  accounts.operator = accounts.shift();
  accounts.whitelister = accounts.shift();
  accounts.alice = accounts.shift();
  accounts.bruce = accounts.shift();
  accounts.chris = accounts.shift();
  accounts.other = accounts.shift();
  accounts.archiver = accounts.shift();

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
        archiver: { members: [accounts.archiver].map(getAddress) },
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

module.exports = {
  fixture,
  getAddress,
};
