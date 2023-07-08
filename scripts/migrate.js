const { ethers }           = require('hardhat');
const defaultsDeep         = require('lodash.defaultsdeep');
const { MigrationManager } = require('@amxx/hre/scripts');
const DEBUG                = require('debug')('migration');
const DEFAULT              = require('./config');

async function migrate(config = {}, opts = {}) {
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

    const manager = await ethers.getContractFactory('PermissionManager')
        .then(factory => migration.migrate(
            'manager',
            factory,
            [ deployer.address ],
            { ...opts, kind: 'uups' },
        ));

    const token   = await ethers.getContractFactory('Token')
        .then(factory => migration.migrate(
            'token',
            factory,
            [ config?.token?.name, config?.token?.symbol ],
            { ...opts, kind: 'uups', constructorArgs: [ manager.address ] },
        ));

    return {
        config,
        deployer,
        contracts: {
            manager,
            token,
        },
    }
}

if (require.main === module) {
    migrate()
        .then(() => process.exit(0))
        .catch(error => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = {
    migrate,
};