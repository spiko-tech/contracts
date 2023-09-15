require('chai').use(require('ethereum-waffle').solidity);

const { expect            } = require('chai');
const { ethers            } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');
const { deploy            } = require('@amxx/hre/scripts/index');
const { migrate           } = require('../scripts/migrate');
const { Enum, toMask, combine } = require('./helpers');

const GROUPS = Array(256);
GROUPS[0]    = 'ADMIN'
GROUPS[1]    = 'OPERATOR'
GROUPS[2]    = 'BURNER'
GROUPS[3]    = 'WHITELISTER'
GROUPS[4]    = 'WHITELISTED'
GROUPS[255]  = 'PUBLIC';
const MASKS  = GROUPS.map((_, i) => toMask(i));
Object.assign(GROUPS, Object.fromEntries(GROUPS.map((key, i) => [ key, i ]).filter(Boolean)));
Object.assign(MASKS, Object.fromEntries(GROUPS.map((key, i) => [ key, MASKS[i] ]).filter(Boolean)));

const STATUS = Enum('NULL', 'PENDING', 'EXECUTED', 'CANCELED');

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
    await contracts.manager.connect(accounts.admin      ).addGroup(contracts.redemption.address, GROUPS.BURNER);
    await contracts.manager.connect(accounts.whitelister).addGroup(accounts.alice.address,       GROUPS.WHITELISTED);
    await contracts.manager.connect(accounts.whitelister).addGroup(accounts.bruce.address,       GROUPS.WHITELISTED);
    await contracts.manager.connect(accounts.whitelister).addGroup(contracts.redemption.address, GROUPS.WHITELISTED);

    // restricted functions
    const settings = {
        token: {
            upgradeTo: [ GROUPS.ADMIN                   ],
            mint:      [ GROUPS.OPERATOR                ],
            burn:      [ GROUPS.OPERATOR, GROUPS.BURNER ],
            pause:     [ GROUPS.OPERATOR                ],
            unpause:   [ GROUPS.OPERATOR                ],
            transfer:  [ GROUPS.WHITELISTED             ],
        },
        oracle: {
            upgradeTo:    [ GROUPS.ADMIN    ],
            publishPrice: [ GROUPS.OPERATOR ],
        },
        redemption: {
            upgradeTo:         [ GROUPS.ADMIN    ],
            executeRedemption: [ GROUPS.OPERATOR ],
            registerOutput:    [ GROUPS.OPERATOR ],
        },
    };

    await contracts.manager.multicall(
        Object.values(
            Object.entries(settings)
            .flatMap(([ name, fns ]) =>
                Object.entries(fns)
                .map(([ sig, groups ]) => [ contracts[name].address, contracts[name].interface.getSighash(sig), groups ])
            )
            .reduce((acc, [ address, selector, groups ]) => {
                const key = `${address}-${combine(...groups)}`;
                acc[key] ??= { address, groups, selectors: [] };
                acc[key].selectors.push(selector);
                return acc;
            }, {})
        ).map(({ address, selectors, groups }) => contracts.manager.interface.encodeFunctionData('setRequirements', [ address, selectors, groups ]))
    );

    return { accounts, contracts, config };
}

describe('Main', function () {
    beforeEach(async function () {
        await loadFixture(fixture).then(results => Object.assign(this, results));
    });

    it('post deployment state', async function () {
        expect(await this.contracts.manager.ADMIN()).to.be.equal(GROUPS.ADMIN);
        expect(await this.contracts.manager.PUBLIC()).to.be.equal(GROUPS.PUBLIC);
        expect(await this.contracts.manager.ADMIN_MASK()).to.be.equal(MASKS.ADMIN);
        expect(await this.contracts.manager.PUBLIC_MASK()).to.be.equal(MASKS.PUBLIC);

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
        // token
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('upgradeTo'))).to.be.equal(combine(MASKS.ADMIN));
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('mint'     ))).to.be.equal(combine(MASKS.ADMIN, MASKS.OPERATOR));
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('burn'     ))).to.be.equal(combine(MASKS.ADMIN, MASKS.OPERATOR, MASKS.BURNER));
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('pause'    ))).to.be.equal(combine(MASKS.ADMIN, MASKS.OPERATOR));
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('unpause'  ))).to.be.equal(combine(MASKS.ADMIN, MASKS.OPERATOR));
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('transfer' ))).to.be.equal(combine(MASKS.ADMIN, MASKS.WHITELISTED));
        // oracle
        expect(await this.contracts.manager.getRequirements(this.contracts.oracle.address, this.contracts.oracle.interface.getSighash('upgradeTo'   ))).to.be.equal(combine(MASKS.ADMIN));
        expect(await this.contracts.manager.getRequirements(this.contracts.oracle.address, this.contracts.oracle.interface.getSighash('publishPrice'))).to.be.equal(combine(MASKS.ADMIN, MASKS.OPERATOR));
        // redemption
        expect(await this.contracts.manager.getRequirements(this.contracts.redemption.address, this.contracts.redemption.interface.getSighash('upgradeTo'        ))).to.be.equal(combine(MASKS.ADMIN));
        expect(await this.contracts.manager.getRequirements(this.contracts.redemption.address, this.contracts.redemption.interface.getSighash('executeRedemption'))).to.be.equal(combine(MASKS.ADMIN, MASKS.OPERATOR));
        expect(await this.contracts.manager.getRequirements(this.contracts.redemption.address, this.contracts.redemption.interface.getSighash('registerOutput'   ))).to.be.equal(combine(MASKS.ADMIN, MASKS.OPERATOR));
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
            it('authorized', async function () {
                const roundId   = 0;
                const value     = 17;
                const timepoint = 42;

                expect(await this.contracts.oracle.getLatestPrice()).to.be.equal(0);
                await expect(this.contracts.oracle.latestRoundData()).to.be.reverted;

                expect(await this.contracts.oracle.connect(this.accounts.operator).publishPrice(timepoint, value))
                .to.emit(this.contracts.oracle, 'Update').withArgs(timepoint, value, roundId);

                expect(await this.contracts.oracle.getLatestPrice()).to.be.equal(value);

                const latestRoundData = await this.contracts.oracle.latestRoundData();
                expect(latestRoundData.roundId        ).to.be.equal(roundId  );
                expect(latestRoundData.answer         ).to.be.equal(value    );
                expect(latestRoundData.startedAt      ).to.be.equal(timepoint);
                expect(latestRoundData.updatedAt      ).to.be.equal(timepoint);
                expect(latestRoundData.answeredInRound).to.be.equal(roundId  );

                const getRoundData = await this.contracts.oracle.getRoundData(roundId);
                expect(getRoundData.roundId        ).to.be.equal(roundId  );
                expect(getRoundData.answer         ).to.be.equal(value    );
                expect(getRoundData.startedAt      ).to.be.equal(timepoint);
                expect(getRoundData.updatedAt      ).to.be.equal(timepoint);
                expect(getRoundData.answeredInRound).to.be.equal(roundId  );
            });

            it('unauthorized caller (need operator)', async function () {
                await expect(this.contracts.oracle.connect(this.accounts.other).publishPrice(42, 17))
                .to.be.revertedWith('Restricted access');
            });

            it('updates last entry', async function () {
                const rounds = [
                    { timepoint: 17, value: 1 },
                    { timepoint: 42, value: 6 },
                    { timepoint: 69, value: 3 },
                    { timepoint: 81, value: 9 },
                ];

                for (const [ roundId, { timepoint, value } ] of Object.entries(rounds)) {
                    expect(await this.contracts.oracle.connect(this.accounts.operator).publishPrice(timepoint, value))
                    .to.emit(this.contracts.oracle, 'Update').withArgs(timepoint, value, roundId);

                    expect(await this.contracts.oracle.getLatestPrice()).to.be.equal(value);

                    const latestRoundData = await this.contracts.oracle.latestRoundData();
                    expect(latestRoundData.roundId        ).to.be.equal(roundId  );
                    expect(latestRoundData.answer         ).to.be.equal(value    );
                    expect(latestRoundData.startedAt      ).to.be.equal(timepoint);
                    expect(latestRoundData.updatedAt      ).to.be.equal(timepoint);
                    expect(latestRoundData.answeredInRound).to.be.equal(roundId  );
                }

                for (const [ roundId, { timepoint, value } ] of Object.entries(rounds)) {
                    const getRoundData = await this.contracts.oracle.getRoundData(roundId);
                    expect(getRoundData.roundId        ).to.be.equal(roundId  );
                    expect(getRoundData.answer         ).to.be.equal(value    );
                    expect(getRoundData.startedAt      ).to.be.equal(timepoint);
                    expect(getRoundData.updatedAt      ).to.be.equal(timepoint);
                    expect(getRoundData.answeredInRound).to.be.equal(roundId  );
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
                expect(await this.contracts.oracle.connect(this.accounts.operator).publishPrice(timepoint, value));
            }

            // Perform lookups
            for (const t of Array.range(rounds.at(-1).timepoint + 2)) {
                expect(await this.contracts.oracle.getHistoricalPrice(t))
                .to.be.equal(rounds.findLast(({ timepoint }) => timepoint <= t)?.value ?? 0);
            }
        });
    });

    describe('Redemption', function () {
        const { address: output } = ethers.Wallet.createRandom();

        beforeEach(async function () {
            // mint tokens
            await this.contracts.token.connect(this.accounts.operator).mint(this.accounts.alice.address, 1000);

            // set authorized output token
            await this.contracts.redemption.registerOutput(
                this.contracts.token.address,
                output,
                true,
            );

            // make operation
            this.makeOp = (overrides = {}) => {
                const result = {};
                result.user   = overrides?.user   ?? this.accounts.alice;
                result.input  = overrides?.input  ?? this.contracts.token;
                result.output = overrides?.output ?? output;
                result.value  = overrides?.value  ?? 100;
                result.salt   = overrides?.salt   ?? ethers.utils.hexlify(ethers.utils.randomBytes(32));
                result.id     = ethers.utils.solidityKeccak256(
                    [ 'address', 'address', 'address', 'uint256', 'bytes32' ],
                    [ result.user?.address ?? result.user, result.input?.address ?? result.input, result.output?.address ?? result.output, result.value, result.salt ],
                );
                result.data   = ethers.utils.defaultAbiCoder.encode(
                    [ 'address', 'bytes32' ],
                    [ result.output?.address ?? result.output, result.salt ],
                );
                return result;
            }
        });

        describe('initiate redemption', function () {
            it('success', async function () {
                const op = this.makeOp();

                const { status: statusBefore, deadline: deadlineBefore } = await this.contracts.redemption.details(op.id);
                expect(statusBefore).to.be.equal(STATUS.NULL);
                expect(deadlineBefore).to.be.equal(0);

                expect(await op.input.connect(op.user)['transferAndCall(address,uint256,bytes)'](this.contracts.redemption.address, op.value, op.data))
                .to.emit(op.input,                  'Transfer'           ).withArgs(op.user.address, this.contracts.redemption.address, op.value)
                .to.emit(this.contracts.redemption, 'RedemptionInitiated').withArgs(op.id, op.user.address, op.input.address, op.output, op.value, op.salt);

                const timepoint = await time.latest();

                const { status: statusAfter, deadline: deadlineAfter } = await this.contracts.redemption.details(op.id);
                expect(statusAfter).to.be.equal(STATUS.PENDING);
                expect(deadlineAfter).to.be.equal(timepoint + time.duration.days(7));
            });

            it('duplicated id', async function () {
                const op = this.makeOp();

                // first call is ok
                await op.input.connect(op.user)['transferAndCall(address,uint256,bytes)'](this.contracts.redemption.address, op.value, op.data);

                // reusing the same operation details with the same salt is not ok
                await expect(op.input.connect(op.user)['transferAndCall(address,uint256,bytes)'](this.contracts.redemption.address, op.value, op.data))
                .to.be.revertedWith('ID already used')
            });

            it('unauthorized output', async function () {
                const op = this.makeOp({ output: this.accounts.other });

                await expect(op.input.connect(op.user)['transferAndCall(address,uint256,bytes)'](this.contracts.redemption.address, op.value, op.data))
                .to.be.revertedWith('Input/Output pair is not authorized');
            });

            it('direct call to onTransferReceived', async function () {
                const op = this.makeOp({ input: this.accounts.alice });

                await expect(this.contracts.redemption.connect(op.user).onTransferReceived(
                    op.user.address,
                    op.user.address,
                    op.value,
                    op.data,
                )).to.be.revertedWith('Input/Output pair is not authorized');
            });
        });

        describe('execute redemption', function () {
            beforeEach(async function () {
                this.operation = this.makeOp();

                await this.operation.input.connect(this.operation.user)['transferAndCall(address,uint256,bytes)'](
                    this.contracts.redemption.address,
                    this.operation.value,
                    this.operation.data,
                );

                this.operation.deadline = (await time.latest()) + time.duration.days(7);
            });

            it('authorized', async function () {
                const data = ethers.utils.hexlify(ethers.utils.randomBytes(64));

                const { status: statusBefore } = await this.contracts.redemption.details(this.operation.id);
                expect(statusBefore).to.be.equal(STATUS.PENDING);

                expect(await this.contracts.redemption.connect(this.accounts.operator).executeRedemption(
                    this.operation.user.address,
                    this.operation.input.address,
                    this.operation.output,
                    this.operation.value,
                    this.operation.salt,
                    data,
                ))
                .to.emit(this.operation.input,      'Transfer'          ).withArgs(this.contracts.redemption.address, ethers.constants.AddressZero, this.operation.value)
                .to.emit(this.contracts.redemption, 'RedemptionExecuted').withArgs(this.operation.id, data);

                const { status: statusAfter } = await this.contracts.redemption.details(this.operation.id);
                expect(statusAfter).to.be.equal(STATUS.EXECUTED);
            });

            it('unauthorized', async function () {
                const data = ethers.utils.hexlify(ethers.utils.randomBytes(64));

                await expect(this.contracts.redemption.connect(this.accounts.other).executeRedemption(
                    this.operation.user.address,
                    this.operation.input.address,
                    this.operation.output,
                    this.operation.value,
                    this.operation.salt,
                    data,
                )).to.be.revertedWith('Restricted access');
            });

            it('invalid operation', async function () {
                const data = ethers.utils.hexlify(ethers.utils.randomBytes(64));

                await expect(this.contracts.redemption.connect(this.accounts.operator).executeRedemption(
                    this.accounts.other.address, // invalid user
                    this.operation.input.address,
                    this.operation.output,
                    this.operation.value,
                    this.operation.salt,
                    data,
                )).to.be.revertedWith('Operation is not pending');
            });

            it('too late', async function () {
                const data = ethers.utils.hexlify(ethers.utils.randomBytes(64));

                await time.increase(time.duration.days(10));

                await expect(this.contracts.redemption.connect(this.accounts.operator).executeRedemption(
                    this.operation.user.address,
                    this.operation.input.address,
                    this.operation.output,
                    this.operation.value,
                    this.operation.salt,
                    data,
                )).to.be.revertedWith('Deadline passed');
            });
        });

        describe('cancel redemption', function () {
            it.skip('invalid operation');
            it.skip('too early');
        });

        describe('admin', function () {
            const { address: other } = ethers.Wallet.createRandom();

            describe('enable output', function () {
                it('authorized', async function () {
                    expect(await this.contracts.redemption.outputsFor(this.contracts.token.address)).to.be.deep.equal([ output ]);

                    expect(await this.contracts.redemption.connect(this.accounts.admin).registerOutput(this.contracts.token.address, other, true))
                    .to.emit(this.contracts.redemption, 'EnableOutput').withArgs(this.contracts.token.address, other, true);

                    expect(await this.contracts.redemption.outputsFor(this.contracts.token.address)).to.be.deep.equal([ output, other ]);
                });

                it('unauthorized', async function () {
                    expect(await this.contracts.redemption.outputsFor(this.contracts.token.address)).to.be.deep.equal([ output ]);

                    await expect(this.contracts.redemption.connect(this.accounts.other).registerOutput(this.contracts.token.address, other, true))
                    .to.be.revertedWith('Restricted access');

                    expect(await this.contracts.redemption.outputsFor(this.contracts.token.address)).to.be.deep.equal([ output ]);
                });

                it('no-effect', async function () {
                    expect(await this.contracts.redemption.outputsFor(this.contracts.token.address)).to.be.deep.equal([ output ]);

                    expect(await this.contracts.redemption.connect(this.accounts.admin).registerOutput(this.contracts.token.address, output, true))
                    .to.emit(this.contracts.redemption, 'EnableOutput').withArgs(this.contracts.token.address, output, true);

                    expect(await this.contracts.redemption.outputsFor(this.contracts.token.address)).to.be.deep.equal([ output ]);
                });
            });

            describe('disable output', function () {
                it('authorized', async function () {
                    expect(await this.contracts.redemption.outputsFor(this.contracts.token.address)).to.be.deep.equal([ output ]);

                    expect(await this.contracts.redemption.connect(this.accounts.admin).registerOutput(this.contracts.token.address, output, false))
                    .to.emit(this.contracts.redemption, 'EnableOutput').withArgs(this.contracts.token.address, output, false);

                    expect(await this.contracts.redemption.outputsFor(this.contracts.token.address)).to.be.deep.equal([ ]);
                });

                it('unauthorized', async function () {
                    expect(await this.contracts.redemption.outputsFor(this.contracts.token.address)).to.be.deep.equal([ output ]);

                    await expect(this.contracts.redemption.connect(this.accounts.other).registerOutput(this.contracts.token.address, output, false))
                    .to.be.revertedWith('Restricted access');

                    expect(await this.contracts.redemption.outputsFor(this.contracts.token.address)).to.be.deep.equal([ output ]);
                });

                it('no-effect', async function () {
                    expect(await this.contracts.redemption.outputsFor(this.contracts.token.address)).to.be.deep.equal([ output ]);

                    expect(await this.contracts.redemption.connect(this.accounts.admin).registerOutput(this.contracts.token.address, other, false))
                    .to.emit(this.contracts.redemption, 'EnableOutput').withArgs(this.contracts.token.address, other, false);

                    expect(await this.contracts.redemption.outputsFor(this.contracts.token.address)).to.be.deep.equal([ output ]);
                });
            });
        });
    });
});
