const defaultsDeep         = require('lodash.defaultsdeep');
const { ethers, upgrades } = require('hardhat');
const { MigrationManager } = require('@amxx/hre/scripts');
const DEFAULT              = require('./config');
const DEBUG                = require('debug')('migration');

require('dotenv').config();

async function upgrade(config = {}, opts = {}) {
    config = defaultsDeep(config, DEFAULT);

    const provider = config.provider ?? ethers.provider;
    const deployer = config.deployer ?? await provider.getSigner();
    deployer.address = await deployer.getAddress();

    const { name, chainId } = await provider.getNetwork();
    DEBUG(`Network:  ${name} (${chainId})`);
    DEBUG(`Deployer: ${deployer.address}`);
    DEBUG('----------------------------------------------------');

    const migration = new MigrationManager(provider, config);
    await migration.ready();

    // load singletons from cache
    const forwarder  = await migration.cache.get('forwarder');
    const manager    = await migration.cache.get('manager');

    // load & upgrade redemption contract
    const redemption = await migration.cache.get('redemption');
    await ethers.getContractFactory('Redemption2').then(factory => upgrades.upgradeProxy(redemption.address, factory, { constructorArgs: [ manager.address ] }));
    // TODO: verify implementation

    // load & upgrade token contracts
    for (const { symbol } of config?.contracts?.tokens || []) {
        const token = await migration.cache.get(`token-${symbol}`);
        await ethers.getContractFactory('Token2').then(factory => upgrades.upgradeProxy(token.address, factory, { constructorArgs: [ manager.address, forwarder.address ] }));
        // TODO: verify implementation
    }
}

if (require.main === module) {
    upgrade().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
}

module.exports = {
    upgrade,
};