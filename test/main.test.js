require('chai').use(require('ethereum-waffle').solidity);

const { expect      } = require('chai');
const { ethers      } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { migrate     } = require('../scripts/migrate')

const toHexString = i => '0x' + i.toString(16).padStart(64, 0);
const toMask      = i => toHexString(1n << BigInt(i));
const combine = (...masks) => toHexString(masks.reduce((acc, m) => acc | BigInt(m), 0n));

const GROUPS = Array(256);
GROUPS[0]    = 'ADMIN'
GROUPS[1]    = 'OPERATOR'
GROUPS[2]    = 'WHITELISTER'
GROUPS[3]    = 'WHITELISTED'
GROUPS[255]  = 'PUBLIC';
const MASKS  = GROUPS.map((_, i) => toMask(i));
Object.assign(GROUPS, Object.fromEntries(GROUPS.map((key, i) => [ key, i ]).filter(Boolean)));
Object.assign(MASKS, Object.fromEntries(GROUPS.map((key, i) => [ key, MASKS[i] ]).filter(Boolean)));

async function fixture() {
    const accounts       = await ethers.getSigners();
    accounts.admin       = accounts.shift();
    accounts.operator    = accounts.shift();
    accounts.whitelister = accounts.shift();
    accounts.alice       = accounts.shift();
    accounts.bruce       = accounts.shift();
    accounts.chris       = accounts.shift();
    accounts.other       = accounts.shift();

    const { contracts, config } = await migrate(
        { deployer: accounts.admin },
        { noCache: true, noConfirm: true },
    );

    contracts.token  = Object.values(contracts.tokens).find(Boolean);
    contracts.oracle = Object.values(contracts.oracles).find(Boolean);
    expect(await contracts.oracle.token()).to.be.equal(contracts.token.address, "Invalid configuration for testing");

    // set group admins
    await contracts.manager.connect(accounts.admin).setGroupAdmins(GROUPS.WHITELISTED, [ GROUPS.WHITELISTER ]);

    // populate groups
    await contracts.manager.connect(accounts.admin      ).addGroup(accounts.operator.address,    GROUPS.OPERATOR);
    await contracts.manager.connect(accounts.admin      ).addGroup(accounts.whitelister.address, GROUPS.WHITELISTER);
    await contracts.manager.connect(accounts.whitelister).addGroup(accounts.alice.address,       GROUPS.WHITELISTED);
    await contracts.manager.connect(accounts.whitelister).addGroup(accounts.bruce.address,       GROUPS.WHITELISTED);

    // restricted functions
    // const makePerms = (target, fnToGroupList) => Object.entries(fnToGroupList).reduce((acc, [ k, v ]) => { acc[v] ??= []; acc[v].push(target.interface.getSighash(k)); return acc; }, {});


    const settings = {
        token: {
            upgradeTo: [ GROUPS.ADMIN       ],
            mint:      [ GROUPS.OPERATOR    ],
            burn:      [ GROUPS.OPERATOR    ],
            pause:     [ GROUPS.OPERATOR    ],
            unpause:   [ GROUPS.OPERATOR    ],
            transfer:  [ GROUPS.WHITELISTED ],
        },
        oracle: {
            upgradeTo:    [ GROUPS.ADMIN    ],
            publishPrice: [ GROUPS.OPERATOR ],
        },
    }

    await contracts.manager.multicall(
        Object.entries(settings)
        .flatMap(([ name, fns ]) =>
            Object.entries(
                Object.entries(fns)
                .reduce((acc, [ sig, group ]) => { acc[group] ??= []; acc[group].push(contracts[name].interface.getSighash(sig)); return acc; }, {})
            )
            .map(([ group, selectors ]) =>
                contracts.manager.interface.encodeFunctionData('setRequirements', [ contracts[name].address, selectors, [ group ]])
            )
    ));

    return { accounts, contracts, config };
}

describe('Main', function () {
    beforeEach(async function () {
        await loadFixture(fixture).then(results => Object.assign(this, results));
    });

    it('post deployment state', async function () {
        expect(await this.contracts.manager.ADMIN()).to.be.equal(MASKS.ADMIN);
        expect(await this.contracts.manager.PUBLIC()).to.be.equal(MASKS.PUBLIC);

        expect(await this.contracts.token.authority()).to.be.equal(this.contracts.manager.address);
        expect(await this.contracts.token.name()).to.be.equal(this.config.tokens.find(Boolean).name);
        expect(await this.contracts.token.symbol()).to.be.equal(this.config.tokens.find(Boolean).symbol);
        expect(await this.contracts.token.decimals()).to.be.equal(18);
        expect(await this.contracts.token.totalSupply()).to.be.equal(0);

        expect(await this.contracts.oracle.authority()).to.be.equal(this.contracts.manager.address);
        expect(await this.contracts.oracle.token()).to.be.equal(this.contracts.token.address);
        expect(await this.contracts.oracle.version()).to.be.equal(0);
        expect(await this.contracts.oracle.decimals()).to.be.equal(18);
        expect(await this.contracts.oracle.description()).to.be.equal(`${this.config.tokens.find(Boolean).symbol} / ${this.config.tokens.find(Boolean).quote}`);
    });

    it('accounts have permissions', async function () {
        expect(await this.contracts.manager.getGroups(this.accounts.admin.address      )).to.be.equal(combine(MASKS.PUBLIC, MASKS.ADMIN));
        expect(await this.contracts.manager.getGroups(this.accounts.operator.address   )).to.be.equal(combine(MASKS.PUBLIC, MASKS.OPERATOR));
        expect(await this.contracts.manager.getGroups(this.accounts.whitelister.address)).to.be.equal(combine(MASKS.PUBLIC, MASKS.WHITELISTER));
        expect(await this.contracts.manager.getGroups(this.accounts.alice.address      )).to.be.equal(combine(MASKS.PUBLIC, MASKS.WHITELISTED));
        expect(await this.contracts.manager.getGroups(this.accounts.bruce.address      )).to.be.equal(combine(MASKS.PUBLIC, MASKS.WHITELISTED));
        expect(await this.contracts.manager.getGroups(this.accounts.chris.address      )).to.be.equal(combine(MASKS.PUBLIC));
    });

    it('functions have requirements', async function () {
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('upgradeTo'))).to.be.equal(combine(MASKS.ADMIN));
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('mint'     ))).to.be.equal(combine(MASKS.ADMIN, MASKS.OPERATOR));
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('burn'     ))).to.be.equal(combine(MASKS.ADMIN, MASKS.OPERATOR));
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('pause'    ))).to.be.equal(combine(MASKS.ADMIN, MASKS.OPERATOR));
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('unpause'  ))).to.be.equal(combine(MASKS.ADMIN, MASKS.OPERATOR));
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('transfer' ))).to.be.equal(combine(MASKS.ADMIN, MASKS.WHITELISTED));
    });

    describe('Token', function () {
        describe('ERC20', function () {
            describe('mint', function () {
                it('authorized', async function () {
                    await expect(this.contracts.token.connect(this.accounts.operator).mint(this.accounts.alice.address, 1000))
                    .to.emit(this.contracts.token, 'Transfer').withArgs(ethers.constants.AddressZero, this.accounts.alice.address, 1000);
                });

                it('unauthorized caller (need operator)', async function () {
                    await expect(this.contracts.token.connect(this.accounts.alice).mint(this.accounts.alice.address, 1000))
                    .to.be.revertedWith('Restricted access');
                });

                it('unauthorized to (need whitelisted)', async function () {
                    await expect(this.contracts.token.connect(this.accounts.operator).mint(this.accounts.chris.address, 1000))
                    .to.be.revertedWith('unauthorized to');
                });
            });

            describe('burn', function () {
                beforeEach(async function () {
                    await this.contracts.token.connect(this.accounts.operator).mint(this.accounts.alice.address, 1000)
                });

                it('authorized', async function () {
                    await expect(this.contracts.token.connect(this.accounts.operator).burn(this.accounts.alice.address, 100))
                    .to.emit(this.contracts.token, 'Transfer').withArgs(this.accounts.alice.address, ethers.constants.AddressZero, 100);
                });

                it('unauthorized caller (need operator)', async function () {
                    await expect(this.contracts.token.connect(this.accounts.alice).burn(this.accounts.alice.address, 100))
                    .to.be.revertedWith('Restricted access');
                });

                it('can burn from not-whitelisted account', async function () {
                    // whitelist, mint, blacklist
                    await Promise.all([
                        this.contracts.manager.connect(this.accounts.whitelister).addGroup(this.accounts.chris.address, GROUPS.WHITELISTED),
                        this.contracts.token.connect(this.accounts.operator).mint(this.accounts.chris.address, 1000),
                        this.contracts.manager.connect(this.accounts.whitelister).remGroup(this.accounts.chris.address, GROUPS.WHITELISTED),
                    ]);

                    await expect(this.contracts.token.connect(this.accounts.operator).burn(this.accounts.chris.address, 100))
                    .to.emit(this.contracts.token, 'Transfer').withArgs(this.accounts.chris.address, ethers.constants.AddressZero, 100);
                });
            });

            describe('transfers', function () {
                beforeEach(async function () {
                    this.mock = await ethers.getContractFactory('ERC1363ReceiverMock')
                        .then(factory  => factory.deploy())
                        .then(contract => contract.deployed());

                    await this.contracts.token.connect(this.accounts.operator).mint(this.accounts.alice.address, 1000);
                });

                for (const fn of [ 'transfer', 'transferFrom', 'transferAndCall', 'transferFromAndCall' ])
                    describe(fn, function () {
                        for (const fromAuthorized of [true, false])
                        for (const toAuthorized   of [true, false])
                        {
                            it([
                                fromAuthorized ? 'from authorized' : 'from unauthorized',
                                '+',
                                toAuthorized   ? 'to authorized'   : 'to unauthorized',
                                '=',
                                (fromAuthorized && toAuthorized) ? 'ok' : 'revert'
                            ].join(' '), async function () {
                                let from     = this.accounts.alice; // Alice has tokens to send
                                let to       = this.mock;           // ERC1363 compatible receiver
                                let operator = fn.includes('From') ? this.accounts.other : null;
                                let amount   = 10;

                                // set approval if needed + configure sender and receiver
                                operator && await this.contracts.token.connect(from).approve(operator.address, amount);
                                await this.contracts.manager.connect(this.accounts.whitelister)[fromAuthorized ? 'addGroup' : 'remGroup'](from.address, GROUPS.WHITELISTED);
                                await this.contracts.manager.connect(this.accounts.whitelister)[toAuthorized   ? 'addGroup' : 'remGroup'](to.address,   GROUPS.WHITELISTED);

                                let promise = null;
                                switch(fn) {
                                    case 'transfer':
                                        promise = this.contracts.token.connect(from).transfer(to.address, amount)
                                        break;
                                    case 'transferFrom':
                                        promise = this.contracts.token.connect(operator).transferFrom(from.address, to.address, amount);
                                        break;
                                    case 'transferAndCall':
                                        promise = this.contracts.token.connect(from)['transferAndCall(address,uint256)'](to.address, amount);
                                        break;
                                    case 'transferFromAndCall':
                                        promise = this.contracts.token.connect(operator)['transferFromAndCall(address,address,uint256)'](from.address, to.address, amount);
                                        break;
                                }

                                (fromAuthorized && toAuthorized)
                                    ? await expect(promise).to.emit(this.contracts.token, 'Transfer').withArgs(from.address, to.address, amount)
                                    : await expect(promise).to.be.revertedWith((!fromAuthorized && 'unauthorized from') || (!toAuthorized && 'unauthorized to'));
                            });
                        }
                    });
            });

            describe('pause', function () {
                it('authorized', async function () {
                    await expect(this.contracts.token.connect(this.accounts.operator).pause())
                    .to.emit(this.contracts.token, 'Paused').withArgs(this.accounts.operator.address);
                });

                it('unauthorized caller (need operator)', async function () {
                    await expect(this.contracts.token.connect(this.accounts.alice).pause())
                    .to.be.revertedWith('Restricted access');
                });

                it('pausing disables transfers', async function () {
                    await this.contracts.token.connect(this.accounts.operator).pause();

                    await expect(this.contracts.token.connect(this.accounts.alice).transfer(this.accounts.bruce.address, 0))
                    .to.be.revertedWith('ERC20Pausable: token transfer while paused');
                });
            });

            describe('unpause', function () {
                beforeEach(async function () {
                    await this.contracts.token.connect(this.accounts.operator).pause();
                });

                it('authorized', async function () {
                    await expect(this.contracts.token.connect(this.accounts.operator).unpause())
                    .to.emit(this.contracts.token, 'Unpaused').withArgs(this.accounts.operator.address);
                });

                it('unauthorized caller (need operator)', async function () {
                    await expect(this.contracts.token.connect(this.accounts.alice).unpause())
                    .to.be.revertedWith('Restricted access');
                });

                it('unpausing re-enables transfers', async function () {
                    await this.contracts.token.connect(this.accounts.operator).unpause();

                    await expect(this.contracts.token.connect(this.accounts.alice).transfer(this.accounts.bruce.address, 0))
                    .to.emit(this.contracts.token, 'Transfer').withArgs(this.accounts.alice.address, this.accounts.bruce.address, 0);
                });
            });
        });
    });

    describe('Permission Manager', function () {
        const { address: caller } = ethers.Wallet.createRandom();
        const { address: target } = ethers.Wallet.createRandom();
        const selector            = ethers.utils.hexlify(ethers.utils.randomBytes(4));
        const group               = 17;
        const groups              = [ 42, 69 ];

        describe('canCall', function () {
            describe ('simple case: one group', async function() {
                for (const withRequirements of [ true, false ])
                for (const withPermission   of [ true, false ])
                {
                    it([ 'Requirements:', withRequirements ? 'set' : 'unset', '&', 'Permissions:', withPermission ? 'set' : 'unset' ].join(' '), async function () {
                        // set permissions and requirements
                        withRequirements && await this.contracts.manager.setRequirements(target, [ selector ], [ group ]);
                        withPermission   && await this.contracts.manager.addGroup(caller, group);

                        // check can call
                        expect(await this.contracts.manager.canCall(caller, target, selector)).to.be.equal(withRequirements && withPermission);
                    });
                }
            });

            describe ('complexe case: one of many groups', async function() {
                it('some intersection', async function() {
                    this.userGroups = [ 32, 42, 94, 128 ]; // User has all these groups
                    this.targetGroups = [ 17, 35, 42, 69, 91 ]; // Target accepts any of these groups
                });

                it('no intersection', async function() {
                    this.userGroups = [ 32, 50, 94, 128 ]; // User has all these groups
                    this.targetGroups = [ 17, 35, 42, 69, 91 ]; // Target accepts any of these groups
                });

                afterEach(async function () {
                    // set permissions and requirements
                    await Promise.all([
                        this.contracts.manager.setRequirements(target, [ selector ], this.targetGroups),
                        ...this.userGroups.map(group => this.contracts.manager.addGroup(caller, group)),
                    ]);

                    // check can call
                    expect(await this.contracts.manager.canCall(caller, target, selector)).to.be.equal(this.userGroups.some(g => this.targetGroups.includes(g)));
                });
            });
        });

        describe('addGroup', function () {
            it('authorized', async function () {
                await expect(this.contracts.manager.connect(this.accounts.admin).addGroup(this.accounts.alice.address, group))
                .to.emit(this.contracts.manager, 'GroupAdded').withArgs(this.accounts.alice.address, group);
            });

            it('restricted', async function () {
                await expect(this.contracts.manager.connect(this.accounts.other).addGroup(this.accounts.alice.address, group))
                .to.revertedWith('MissingPermissions').withArgs(this.accounts.other.address, MASKS.PUBLIC, MASKS.ADMIN);
            });

            it('with role admin', async function () {
                await expect(this.contracts.manager.connect(this.accounts.whitelister).addGroup(this.accounts.alice.address, group))
                .to.revertedWith('MissingPermissions').withArgs(this.accounts.whitelister.address, combine(MASKS.WHITELISTER, MASKS.PUBLIC), MASKS.ADMIN);

                await this.contracts.manager.setGroupAdmins(group, [ GROUPS.WHITELISTER ]);

                await expect(this.contracts.manager.connect(this.accounts.whitelister).addGroup(this.accounts.alice.address, group))
                .to.emit(this.contracts.manager, 'GroupAdded').withArgs(this.accounts.alice.address, group);
            });

            it('effect', async function () {
                expect(await this.contracts.manager.getGroups(this.accounts.alice.address)).to.be.equal(combine(
                    MASKS.PUBLIC,
                    MASKS.WHITELISTED,
                ));

                await expect(this.contracts.manager.connect(this.accounts.admin).addGroup(this.accounts.alice.address, group))
                .to.emit(this.contracts.manager, 'GroupAdded').withArgs(this.accounts.alice.address, group);

                expect(await this.contracts.manager.getGroups(this.accounts.alice.address)).to.be.equal(combine(
                    MASKS.PUBLIC,
                    MASKS.WHITELISTED,
                    toMask(group),
                ));
            });
        });

        describe('remGroup', function () {
            beforeEach(async function () {
                await this.contracts.manager.connect(this.accounts.admin).addGroup(this.accounts.alice.address, group)
            });

            it('authorized', async function () {
                await expect(this.contracts.manager.connect(this.accounts.admin).remGroup(this.accounts.alice.address, group))
                .to.emit(this.contracts.manager, 'GroupRemoved').withArgs(this.accounts.alice.address, group);
            });

            it('restricted', async function () {
                await expect(this.contracts.manager.connect(this.accounts.other).remGroup(this.accounts.alice.address, group))
                .be.revertedWith('MissingPermissions').withArgs(this.accounts.other.address, MASKS.PUBLIC, MASKS.ADMIN);
            });

            it('with role admin', async function () {
                await expect(this.contracts.manager.connect(this.accounts.whitelister).remGroup(this.accounts.alice.address, group))
                .be.revertedWith('MissingPermissions').withArgs(this.accounts.whitelister.address, combine(MASKS.WHITELISTER, MASKS.PUBLIC), MASKS.ADMIN);

                await this.contracts.manager.setGroupAdmins(group, [ GROUPS.WHITELISTER ]);

                await expect(this.contracts.manager.connect(this.accounts.whitelister).remGroup(this.accounts.alice.address, group))
                .to.emit(this.contracts.manager, 'GroupRemoved').withArgs(this.accounts.alice.address, group);
            });

            it('effect', async function () {
                expect(await this.contracts.manager.getGroups(this.accounts.alice.address)).to.be.equal(combine(
                    MASKS.PUBLIC,
                    MASKS.WHITELISTED,
                    toMask(group),
                ));

                await expect(this.contracts.manager.connect(this.accounts.admin).remGroup(this.accounts.alice.address, group))
                .to.emit(this.contracts.manager, 'GroupRemoved').withArgs(this.accounts.alice.address, group);

                expect(await this.contracts.manager.getGroups(this.accounts.alice.address)).to.be.equal(combine(
                    MASKS.PUBLIC,
                    MASKS.WHITELISTED,
                ));
            });
        });

        describe('setGroupAdmins', function () {
            it('authorized', async function () {
                await expect(this.contracts.manager.connect(this.accounts.admin).setGroupAdmins(group, groups))
                .to.emit(this.contracts.manager, 'GroupAdmins').withArgs(group, combine(...groups.map(toMask)));
            });

            it('restricted', async function () {
                await expect(this.contracts.manager.connect(this.accounts.other).setGroupAdmins(group, groups))
                .to.revertedWith('MissingPermissions').withArgs(this.accounts.other.address, MASKS.PUBLIC, MASKS.ADMIN);
            });

            it('effect', async function () {
                // Set some previous value
                await this.contracts.manager.connect(this.accounts.admin).setGroupAdmins(group, [ group ]);

                // Check previous value is set
                expect(await this.contracts.manager.getGroupAdmins(group)).to.be.equal(combine(
                    MASKS.ADMIN,
                    toMask(group),
                ));

                // Set some new values
                await expect(this.contracts.manager.connect(this.accounts.admin).setGroupAdmins(group, groups))
                .to.emit(this.contracts.manager, 'GroupAdmins').withArgs(group, combine(...groups.map(toMask)));

                // Check the new values are set, and the previous is removed
                expect(await this.contracts.manager.getGroupAdmins(group)).to.be.equal(combine(
                    MASKS.ADMIN,
                    ...groups.map(toMask),
                ));
            });
        });

        describe('setRequirements', function () {
            it('authorized', async function () {
                await expect(this.contracts.manager.connect(this.accounts.admin).setRequirements(target, [ selector ], groups))
                .to.emit(this.contracts.manager, 'Requirements').withArgs(target, selector, combine(...groups.map(toMask)));
            });

            it('restricted', async function () {
                await expect(this.contracts.manager.connect(this.accounts.other).setRequirements(target, [ selector ], groups))
                .to.revertedWith('MissingPermissions').withArgs(this.accounts.other.address, MASKS.PUBLIC, MASKS.ADMIN);
            });

            it('effect', async function () {
                // Set some previous value
                await this.contracts.manager.connect(this.accounts.admin).setRequirements(target, [ selector ], [ group ]);

                // Check previous value is set
                expect(await this.contracts.manager.getRequirements(target, selector)).to.be.equal(combine(
                    MASKS.ADMIN,
                    toMask(group),
                ));

                // Set some new values
                await expect(this.contracts.manager.connect(this.accounts.admin).setRequirements(target, [ selector ], groups))
                .to.emit(this.contracts.manager, 'Requirements').withArgs(target, selector, combine(...groups.map(toMask)));

                // Check the new values are set, and the previous is removed
                expect(await this.contracts.manager.getRequirements(target, selector)).to.be.equal(combine(
                    MASKS.ADMIN,
                    ...groups.map(toMask),
                ));
            });
        });
    });

    describe('Oracle', function () {
        describe('publish price', function () {
            it.skip('authorized');
            it.skip('unauthorized caller (need operator)');
            it.skip('updates last entry');
        });
        describe('getters', function () {
            it.skip('getRoundData');
            it.skip('latestRoundData');
            it.skip('getHistoricalPrice');
            it.skip('getLatestPrice');
        });
    });
});
