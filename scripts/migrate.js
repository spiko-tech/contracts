const { expect }                     = require('chai');
const defaultsDeep                   = require('lodash.defaultsdeep');
const { ethers, run }                = require('hardhat');
const { task }                       = require('hardhat/config');
const { MigrationManager }           = require('@amxx/hre/scripts');
const { toMask, combine  }           = require('../test/helpers');
const DEFAULT                        = require('./config');
const DEBUG                          = require('debug')('migration');

require('dotenv').config();

task("verify-contract", "Verify deployed contract on Etherscan")
    .addParam("address", "Contract address deployed")
    .addParam("chain", "chain to deploy")
    .addParam("permissionManagerAddress", "Arguments permission manager")
    .addParam("forwarderAddress", "Arguments forwarder")
    .setAction(async (_args, hre) => {
        try {
            const constructorArguments = _args.permissionManagerAddress === "" ? [] 
            : (_args.permissionManagerAddress.forwarderAddress === "" ? [_args.permissionManagerAddress] : [_args.permissionManagerAddress, _args.forwarderAddress]);

            console.log(`Constructor Arguments : ${JSON.stringify(constructorArguments)}`)

            await hre.run("verify:verify", {
                address: _args.address,
                chain: _args.chain,
                constructorArguments
            })
        } catch (message) {
            console.error(message)
        }
    });

async function verifyContract(contractName, contractAddress, chain, permissionManagerAddress = "", forwarderAddress = ""){
    console.log(`Verifying ${contractName} at ${contractAddress} on ${chain}`);
    await run("verify-contract", {
        address: contractAddress,
        chain,
        permissionManagerAddress,
        forwarderAddress
   });
}

async function verifyContracts(contracts, chainName) { 
    DEBUG(`Verifying contracts for chain ${chainName}:`)
    DEBUG('----------------------------------------------------');
    const permissionManagerAddress = contracts.manager.target;
    const forwarderAddress = contracts.forwarder.target;
    const redemptionAddress = contracts.redemption.target;
    
    const tokenAddresses = Object.values(contracts.tokens).map(token => token.target);
    const oracleAddresses = Object.values(contracts.oracles).map(oracle => oracle.target);

    await verifyContract("PermissionManager", permissionManagerAddress, chainName);
    await verifyContract("Forwarder", forwarderAddress, chainName, permissionManagerAddress);
    await verifyContract("Redemption", redemptionAddress, chainName, permissionManagerAddress);
}

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

    contracts.forwarder = await ethers.getContractFactory('ERC2771Forwarder')
    .then(factory => migration.migrate(
        'forwarder',
        factory,
        [ 'Forwarder' ],
        { ...opts },
    ));
    DEBUG(`forwarder: ${contracts.forwarder.target}`);

    contracts.manager = await ethers.getContractFactory('PermissionManager')
        .then(factory => migration.migrate(
            'manager',
            factory,
            [ deployer.address ],
            { ...opts, kind: 'uups' },
        ));
    DEBUG(`manager: ${contracts.manager.target}`);

    contracts.redemption = await ethers.getContractFactory('Redemption')
        .then(factory => migration.migrate(
            'redemption',
            factory,
            [],
            { ...opts, kind: 'uups', constructorArgs: [ contracts.manager.target ] },
        ));
    DEBUG(`redemption: ${contracts.redemption.target}`);

    for (const { name, symbol, decimals, oracle } of config?.contracts?.tokens || []) {
        // deploy token
        contracts.tokens[symbol] = await ethers.getContractFactory('Token')
            .then(factory => migration.migrate(
                `token-${symbol}`,
                factory,
                [ name, symbol, decimals ],
                { ...opts, kind: 'uups', constructorArgs: [ contracts.manager.target, contracts.forwarder.target ] },
            ));
        DEBUG(`token[${symbol}]: ${contracts.tokens[symbol].target}`);

        // deploy oracle (if quote is set)
        contracts.oracles[symbol] = oracle && await ethers.getContractFactory('Oracle')
            .then(factory => migration.migrate(
                `oracle-${symbol}`,
                factory,
                [ contracts.tokens[symbol].target, oracle.decimals, oracle.quote ],
                { ...opts, kind: 'uups', constructorArgs: [ contracts.manager.target ] },
            ));
        DEBUG(`oracle[${symbol}]: ${contracts.oracles[symbol].target}`);
    }

    // HELPER
    const getContractByName = name => name.endsWith('[]') ? Object.values(contracts[name.slice(0, -2)]) : [ contracts[name] ];
    const getAddresses      = name => ethers.isAddress(name) ? [ ethers.getAddress(name) ] : getContractByName(name).map(({ target }) => target);
    const asyncFilter       = (promise, expected, yes, no) => Promise.resolve(promise).then(result => (typeof(expected) == 'function' ? expected(result) : result == expected) ? yes : no);

    // GROUP MANAGEMENT
    const ROLES  = Object.keys(config.roles);
    const IDS    = Object.assign(Object.fromEntries(ROLES.map((role, i) => [ role, i         ])), { admin: 0,         ADMIN: 0,         public: 255,         PUBLIC: 255         });
    const MASKS  = Object.assign(Object.fromEntries(ROLES.map((role, i) => [ role, toMask(i) ])), { admin: toMask(0), ADMIN: toMask(0), public: toMask(255), PUBLIC: toMask(255) });

    // CHECKS
    expect([ 'admin', 'ADMIN' ]).to.include(ROLES[0], 'First role must be admin or ADMIN');
    expect(ROLES).to.include.members([].concat(
        ...Object.values(config.roles).map(({ admins = [] }) => admins),
        ...Object.values(config.contracts.fns),
    ), `One roles was not properly declared`);

    // CONFIGURATION
    // Configure role admins
    const roleConfigOps =
        Object.entries(config.roles)
            .filter(([ _, { admins } ]) => admins)
            .map(([ role, { admins } ]) => asyncFilter(
                contracts.manager.getGroupAdmins(IDS[role]),
                combine(MASKS.ADMIN, ...admins.map(admin => MASKS[admin])),
                null,
                { fn: 'setGroupAdmins', args: [ IDS[role], admins.map(admin => IDS[admin]) ] },
            ));

    // Set requirements
    const fnRequirementOps =
        Object.values(
            Object.entries(config?.contracts?.fns ?? [])
                .map(([ id, roles ]) => ({
                    name: id.split('-')[0],
                    fn: id.split('-')[1],
                    roles: roles,
                }))
                .flatMap(({ name, fn, roles}) => getContractByName(name).map(({ target, interface }) => ({
                    address: target,
                    selector: interface.getFunction(fn).selector,
                    groups: roles.map(role => IDS[role]),
                })))
                .reduce((acc, { address, selector, groups }) => {
                    const key = `${address}-${combine(...groups)}`;
                    acc[key] ??= { address, groups, selectors: [] };
                    acc[key].selectors.push(selector);
                    return acc;
                }, {})
        )
        .map(({ address, selectors, groups }) =>
            Promise.all(selectors.map(selector => asyncFilter(
                contracts.manager.getRequirements(address, selector),
                combine(...groups.map(toMask)),
                [],
                [ selector ],
            )))
            .then(blocks => [].concat(...blocks))
            .then(selectors => selectors.length && { fn: 'setRequirements', args: [ address, selectors, groups ] })
        );

    // Add members to groups
    const membershipOps =
        Object.entries(config.roles)
            .flatMap(([ role, { members = [] }]) =>
                members
                    .flatMap(getAddresses)
                    .unique()
                    .map(address => asyncFilter(
                        contracts.manager.getGroups(address),
                        groups => BigInt(groups) & BigInt(MASKS[role]),
                        null,
                        { fn: 'addGroup', args: [ address, IDS[role] ] },
                    ))
            );

    // Deployer renounce admin
    const admins = Object.values(config.roles)[0].members
        .flatMap(getAddresses)
        .unique();

    const renounceOps = !admins.includes(deployer.address) && admins.length && { fn: 'remGroup', args: [ deployer.address, IDS.ADMIN ]};

    // all configuration operations
    const allOps = await Promise.all([
        ...roleConfigOps,
        ...fnRequirementOps,
        ...membershipOps,
        renounceOps,
    ]).then(fns => fns.filter(Boolean));

    DEBUG('Configuration calls:')
    allOps.forEach(({ fn, args }) => DEBUG(`- ${fn}(${args.map(JSON.stringify).join(', ')})`));

    await contracts.manager.multicall(allOps.map(({ fn, args }) => contracts.manager.interface.encodeFunctionData(fn, args)))
        .then(txPromise => txPromise.wait())
        .then(({ logs }) => {
            DEBUG('Events:');
            logs.forEach(({ eventName, args }) => DEBUG(`- ${eventName}: ${args?.join(', ')}`));
        });

    await verifyContracts(contracts, name);

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