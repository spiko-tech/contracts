const { expect }           = require('chai');
const { ethers }           = require('hardhat');
const defaultsDeep         = require('lodash.defaultsdeep');
const { MigrationManager } = require('@amxx/hre/scripts');
const { toMask, combine }  = require('../test/helpers');
const DEFAULT              = require('./config');
const DEBUG                = require('debug')('migration');

require('dotenv').config();

async function migrate(config = {}, opts = {}) {
    config = defaultsDeep(config, DEFAULT);

    opts.noCache   ??= process.env.FORCE;
    opts.noConfirm ??= process.env.FORCE;

    const provider = config.provider ?? ethers.provider;
    const deployer = config.deployer ?? await provider.getSigner();
    deployer.address = await deployer.getAddress();

    const { name, chainId } = await provider.getNetwork();
    DEBUG(`Network:  ${name} (${chainId})`);
    DEBUG(`Deployer: ${deployer.address}`);
    DEBUG('----------------------------------------------------');

    const migration = new MigrationManager(provider, config);
    await migration.ready();

    const contracts = { tokens: {}, oracles: {} };

    contracts.manager = await ethers.getContractFactory('PermissionManager')
        .then(factory => migration.migrate(
            'manager',
            factory,
            [ deployer.address ],
            { ...opts, kind: 'uups' },
        ));
    DEBUG(`manager: ${contracts.manager.address}`);

    contracts.redemption = await ethers.getContractFactory('Redemption')
        .then(factory => migration.migrate(
            'redemption',
            factory,
            [],
            { ...opts, kind: 'uups', constructorArgs: [ contracts.manager.address ] },
        ));
    DEBUG(`redemption: ${contracts.redemption.address}`);

    for (const { name, symbol, quote } of config?.contracts?.tokens || []) {
        // deploy token
        contracts.tokens[symbol] = await ethers.getContractFactory('Token')
            .then(factory => migration.migrate(
                `token-${symbol}`,
                factory,
                [ name, symbol ],
                { ...opts, kind: 'uups', constructorArgs: [ contracts.manager.address ] },
            ));
        DEBUG(`token[${symbol}]: ${contracts.tokens[symbol].address}`);

        // deploy oracle (if quote is set)
        contracts.oracles[symbol] = quote && await ethers.getContractFactory('Oracle')
            .then(factory => migration.migrate(
                `oracle-${symbol}`,
                factory,
                [ contracts.tokens[symbol].address, quote ],
                { ...opts, kind: 'uups', constructorArgs: [ contracts.manager.address ] },
            ));
        DEBUG(`oracle[${symbol}]: ${contracts.oracles[symbol].address}`);
    }

    // HELPER
    const getContractByName = name =>
        name.endsWith('[]')
        ? Object.values(contracts[name.slice(0, -2)])
        : [ contracts[name] ];

    // GROUP MANAGEMENT
    const ROLES  = Object.keys(config.roles);
    const ADMIN  = ROLES[0];
    const IDS    = Object.fromEntries(ROLES.map((role, i) => [ role, i         ]));
    const MASKS  = Object.fromEntries(ROLES.map((role, i) => [ role, toMask(i) ]));
    IDS.public   = 255;
    IDS.PUBLIC   = 255;
    MASKS.public = toMask(255);
    MASKS.PUBLIC = toMask(255);

    // CHECKS
    expect([ 'admin', 'ADMIN' ]).to.include(ADMIN, 'First role must be admin or ADMIN');
    expect(ROLES).to.include.members([].concat(
        ...Object.values(config.roles).map(({ admins = [] }) => admins),
        ...Object.values(config.contracts.fns),
    ), `One roles was not properly declared`);

    // CONFIGURATION
    const txs = await Promise.all([].concat(
        // Configure role admins
        Object.entries(config.roles)
            .filter(([ _, { admins } ]) => admins)
            .map(([ role, { admins } ]) => contracts.manager.getGroupAdmins(IDS[role]).then(current =>
                current == combine(MASKS[ADMIN], ...admins.map(admin => MASKS[admin]))
                    ? []
                    : [ contracts.manager.interface.encodeFunctionData('setGroupAdmins', [ IDS[role], admins.map(admin => IDS[admin]) ]) ]
            )),

        // Set requirements
        Object.values(
            Object.entries(config?.contracts?.fns ?? [])
            .map(([ id, roles ]) => ({
                name: id.split('-')[0],
                fn: id.split('-')[1],
                roles: roles,
            }))
            .flatMap(({ name, fn, roles}) => getContractByName(name).map(({ address, interface }) => ({
                address,
                selector: interface.getSighash(fn),
                groups: roles.map(role => IDS[role]),
            })))
            .reduce((acc, { address, selector, groups }) => {
                const key = `${address}-${combine(...groups)}`;
                acc[key] ??= { address, groups, selectors: [] };
                acc[key].selectors.push(selector);
                return acc;
            }, {})
        )
        .map(({ address, selectors, groups }) => contracts.manager.interface.encodeFunctionData('setRequirements', [ address, selectors, groups ])),

        // Add members to groups
        Object.entries(config.roles).flatMap(([ role, { members = [] }]) =>
            members
            .flatMap(user => ethers.utils.isAddress(user) ? [ user ] : getContractByName(user).map(({ address }) => address))
            .map(address => contracts.manager.interface.encodeFunctionData('addGroup', [ address, IDS[role] ]))
        ),
    )).then(blocks => [].concat(...blocks));

    if (txs.length) {
        DEBUG(`${txs.length} configurations operations`);
        await contracts.manager.multicall(txs).then(tx => tx.wait());
    }

    return {
        config,
        opts,
        deployer,
        contracts,
        roles: { ROLES, IDS, MASKS },
    }
}

if (require.main === module) {
    migrate()
        .then(() => process.exit(0), error => { console.error(error); process.exit(1); });
}

module.exports = {
    migrate,
};