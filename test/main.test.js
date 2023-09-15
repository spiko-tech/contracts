require('chai').use(require('ethereum-waffle').solidity);

const { expect                } = require('chai');
const { ethers, upgrades      } = require('hardhat');
const { loadFixture, time     } = require('@nomicfoundation/hardhat-network-helpers');
const { migrate               } = require('../scripts/migrate');
const { Enum, toMask, combine } = require('./helpers');

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

    const { contracts, config, roles } = await migrate(
        {
            deployer: accounts.admin,
            roles: {
                admin:                  { members: [ accounts.admin.address                                       ] },
                'operator-exceptional': { members: [ accounts.operator.address                                    ] },
                'operator-daily':       { members: [ accounts.operator.address                                    ] },
                'operator-oracle':      { members: [ accounts.operator.address                                    ] },
                'burner':               { members: [ 'redemption'                                                 ] },
                whitelister:            { members: [ accounts.whitelister.address                                 ] },
                whitelisted:            { members: [ accounts.alice.address, accounts.bruce.address, 'redemption' ] },
            },
        },
        { noCache: true, noConfirm: true },
    );

    // get token + oracle
    contracts.token  = Object.values(contracts.tokens).find(Boolean);
    contracts.oracle = Object.values(contracts.oracles).find(Boolean);
    expect(await contracts.oracle.token()).to.be.equal(contracts.token.address, 'Invalid configuration for testing');

    return { accounts, contracts, config, ...roles };
}

describe('Main', function () {
    beforeEach(async function () {
        await loadFixture(fixture).then(results => Object.assign(this, results));
    });

    it('post deployment state', async function () {
        expect(await this.contracts.manager.ADMIN()).to.be.equal(this.IDS.admin);
        expect(await this.contracts.manager.PUBLIC()).to.be.equal(this.IDS.public);
        expect(await this.contracts.manager.ADMIN_MASK()).to.be.equal(this.MASKS.admin);
        expect(await this.contracts.manager.PUBLIC_MASK()).to.be.equal(this.MASKS.public);

        expect(await this.contracts.token.authority()).to.be.equal(this.contracts.manager.address);
        expect(await this.contracts.token.name()).to.be.equal(this.config.contracts.tokens.find(Boolean).name);
        expect(await this.contracts.token.symbol()).to.be.equal(this.config.contracts.tokens.find(Boolean).symbol);
        expect(await this.contracts.token.decimals()).to.be.equal(18);
        expect(await this.contracts.token.totalSupply()).to.be.equal(0);

        expect(await this.contracts.oracle.authority()).to.be.equal(this.contracts.manager.address);
        expect(await this.contracts.oracle.token()).to.be.equal(this.contracts.token.address);
        expect(await this.contracts.oracle.version()).to.be.equal(0);
        expect(await this.contracts.oracle.decimals()).to.be.equal(18);
        expect(await this.contracts.oracle.description()).to.be.equal(`${this.config.contracts.tokens.find(Boolean).symbol} / ${this.config.contracts.tokens.find(Boolean).quote}`);
    });

    it('accounts have permissions', async function () {
        expect(await this.contracts.manager.getGroups(this.contracts.redemption.address)).to.be.equal(combine(this.MASKS.public, this.MASKS.burner, this.MASKS.whitelisted));
        expect(await this.contracts.manager.getGroups(this.accounts.admin.address      )).to.be.equal(combine(this.MASKS.public, this.MASKS.admin));
        expect(await this.contracts.manager.getGroups(this.accounts.operator.address   )).to.be.equal(combine(this.MASKS.public, this.MASKS['operator-daily'], this.MASKS['operator-exceptional'], this.MASKS['operator-oracle']));
        expect(await this.contracts.manager.getGroups(this.accounts.whitelister.address)).to.be.equal(combine(this.MASKS.public, this.MASKS.whitelister));
        expect(await this.contracts.manager.getGroups(this.accounts.alice.address      )).to.be.equal(combine(this.MASKS.public, this.MASKS.whitelisted));
        expect(await this.contracts.manager.getGroups(this.accounts.bruce.address      )).to.be.equal(combine(this.MASKS.public, this.MASKS.whitelisted));
        expect(await this.contracts.manager.getGroups(this.accounts.chris.address      )).to.be.equal(combine(this.MASKS.public));
    });

    it('functions have requirements', async function () {
        // token
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('upgradeTo'))).to.be.equal(combine(this.MASKS.admin));
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('mint'     ))).to.be.equal(combine(this.MASKS.admin, this.MASKS['operator-daily']));
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('burn'     ))).to.be.equal(combine(this.MASKS.admin, this.MASKS['operator-exceptional'], this.MASKS.burner));
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('pause'    ))).to.be.equal(combine(this.MASKS.admin, this.MASKS['operator-exceptional']));
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('unpause'  ))).to.be.equal(combine(this.MASKS.admin, this.MASKS['operator-exceptional']));
        expect(await this.contracts.manager.getRequirements(this.contracts.token.address, this.contracts.token.interface.getSighash('transfer' ))).to.be.equal(combine(this.MASKS.admin, this.MASKS.whitelisted));
        // oracle
        expect(await this.contracts.manager.getRequirements(this.contracts.oracle.address, this.contracts.oracle.interface.getSighash('upgradeTo'   ))).to.be.equal(combine(this.MASKS.admin));
        expect(await this.contracts.manager.getRequirements(this.contracts.oracle.address, this.contracts.oracle.interface.getSighash('publishPrice'))).to.be.equal(combine(this.MASKS.admin, this.MASKS['operator-oracle']));
        // redemption
        expect(await this.contracts.manager.getRequirements(this.contracts.redemption.address, this.contracts.redemption.interface.getSighash('upgradeTo'        ))).to.be.equal(combine(this.MASKS.admin));
        expect(await this.contracts.manager.getRequirements(this.contracts.redemption.address, this.contracts.redemption.interface.getSighash('executeRedemption'))).to.be.equal(combine(this.MASKS.admin, this.MASKS['operator-daily']));
        expect(await this.contracts.manager.getRequirements(this.contracts.redemption.address, this.contracts.redemption.interface.getSighash('registerOutput'   ))).to.be.equal(combine(this.MASKS.admin, this.MASKS['operator-exceptional']));
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
                    .to.be.revertedWith('RestrictedAccess').withArgs(this.accounts.alice.address, this.contracts.token.address, this.contracts.token.interface.getSighash('mint'));
                });

                it('unauthorized to (need whitelisted)', async function () {
                    await expect(this.contracts.token.connect(this.accounts.operator).mint(this.accounts.chris.address, 1000))
                    .to.be.revertedWith('UnauthorizedTo').withArgs(this.contracts.token.address, this.accounts.chris.address);
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
                    .to.be.revertedWith('RestrictedAccess').withArgs(this.accounts.alice.address, this.contracts.token.address, this.contracts.token.interface.getSighash('burn'));
                });

                it('can burn from not-whitelisted account', async function () {
                    // whitelist, mint, blacklist
                    await Promise.all([
                        this.contracts.manager.connect(this.accounts.whitelister).addGroup(this.accounts.chris.address, this.IDS.whitelisted),
                        this.contracts.token.connect(this.accounts.operator).mint(this.accounts.chris.address, 1000),
                        this.contracts.manager.connect(this.accounts.whitelister).remGroup(this.accounts.chris.address, this.IDS.whitelisted),
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
                                await this.contracts.manager.connect(this.accounts.whitelister)[fromAuthorized ? 'addGroup' : 'remGroup'](from.address, this.IDS.whitelisted);
                                await this.contracts.manager.connect(this.accounts.whitelister)[toAuthorized   ? 'addGroup' : 'remGroup'](to.address,   this.IDS.whitelisted);

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

                                await (fromAuthorized && toAuthorized)
                                    ? expect(promise).to.emit(this.contracts.token, 'Transfer').withArgs(from.address, to.address, amount)
                                    : expect(promise).to.be.revertedWith((!fromAuthorized && 'UnauthorizedFrom') || (!toAuthorized && 'UnauthorizedTo')).withArgs(this.contracts.token.address, (!fromAuthorized && from.address) || (!toAuthorized && to.address));
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
                    .to.be.revertedWith('RestrictedAccess').withArgs(this.accounts.alice.address, this.contracts.token.address, this.contracts.token.interface.getSighash('pause'));
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
                    .to.be.revertedWith('RestrictedAccess').withArgs(this.accounts.alice.address, this.contracts.token.address, this.contracts.token.interface.getSighash('unpause'));
                });

                it('unpausing re-enables transfers', async function () {
                    await this.contracts.token.connect(this.accounts.operator).unpause();

                    await expect(this.contracts.token.connect(this.accounts.alice).transfer(this.accounts.bruce.address, 0))
                    .to.emit(this.contracts.token, 'Transfer').withArgs(this.accounts.alice.address, this.accounts.bruce.address, 0);
                });
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
                .to.be.revertedWith('RestrictedAccess').withArgs(this.accounts.other.address, this.contracts.oracle.address, this.contracts.oracle.interface.getSighash('publishPrice'));
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

        it('get non-existing data', async function () {
            await expect(this.contracts.oracle.getRoundData(42))
            .to.be.revertedWith('No checkpoint for roundId');
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
                .to.revertedWith('MissingPermissions').withArgs(this.accounts.other.address, this.MASKS.public, this.MASKS.admin);
            });

            it('with role admin', async function () {
                await expect(this.contracts.manager.connect(this.accounts.whitelister).addGroup(this.accounts.alice.address, group))
                .to.revertedWith('MissingPermissions').withArgs(this.accounts.whitelister.address, combine(this.MASKS.whitelister, this.MASKS.public), this.MASKS.admin);

                await this.contracts.manager.setGroupAdmins(group, [ this.IDS.whitelister ]);

                await expect(this.contracts.manager.connect(this.accounts.whitelister).addGroup(this.accounts.alice.address, group))
                .to.emit(this.contracts.manager, 'GroupAdded').withArgs(this.accounts.alice.address, group);
            });

            it('effect', async function () {
                expect(await this.contracts.manager.getGroups(this.accounts.alice.address)).to.be.equal(combine(
                    this.MASKS.public,
                    this.MASKS.whitelisted,
                ));

                await expect(this.contracts.manager.connect(this.accounts.admin).addGroup(this.accounts.alice.address, group))
                .to.emit(this.contracts.manager, 'GroupAdded').withArgs(this.accounts.alice.address, group);

                expect(await this.contracts.manager.getGroups(this.accounts.alice.address)).to.be.equal(combine(
                    this.MASKS.public,
                    this.MASKS.whitelisted,
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
                .be.revertedWith('MissingPermissions').withArgs(this.accounts.other.address, this.MASKS.public, this.MASKS.admin);
            });

            it('with role admin', async function () {
                await expect(this.contracts.manager.connect(this.accounts.whitelister).remGroup(this.accounts.alice.address, group))
                .be.revertedWith('MissingPermissions').withArgs(this.accounts.whitelister.address, combine(this.MASKS.whitelister, this.MASKS.public), this.MASKS.admin);

                await this.contracts.manager.setGroupAdmins(group, [ this.IDS.whitelister ]);

                await expect(this.contracts.manager.connect(this.accounts.whitelister).remGroup(this.accounts.alice.address, group))
                .to.emit(this.contracts.manager, 'GroupRemoved').withArgs(this.accounts.alice.address, group);
            });

            it('effect', async function () {
                expect(await this.contracts.manager.getGroups(this.accounts.alice.address)).to.be.equal(combine(
                    this.MASKS.public,
                    this.MASKS.whitelisted,
                    toMask(group),
                ));

                await expect(this.contracts.manager.connect(this.accounts.admin).remGroup(this.accounts.alice.address, group))
                .to.emit(this.contracts.manager, 'GroupRemoved').withArgs(this.accounts.alice.address, group);

                expect(await this.contracts.manager.getGroups(this.accounts.alice.address)).to.be.equal(combine(
                    this.MASKS.public,
                    this.MASKS.whitelisted,
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
                .to.revertedWith('MissingPermissions').withArgs(this.accounts.other.address, this.MASKS.public, this.MASKS.admin);
            });

            it('effect', async function () {
                // Set some previous value
                await this.contracts.manager.connect(this.accounts.admin).setGroupAdmins(group, [ group ]);

                // Check previous value is set
                expect(await this.contracts.manager.getGroupAdmins(group)).to.be.equal(combine(
                    this.MASKS.admin,
                    toMask(group),
                ));

                // Set some new values
                await expect(this.contracts.manager.connect(this.accounts.admin).setGroupAdmins(group, groups))
                .to.emit(this.contracts.manager, 'GroupAdmins').withArgs(group, combine(...groups.map(toMask)));

                // Check the new values are set, and the previous is removed
                expect(await this.contracts.manager.getGroupAdmins(group)).to.be.equal(combine(
                    this.MASKS.admin,
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
                .to.revertedWith('MissingPermissions').withArgs(this.accounts.other.address, this.MASKS.public, this.MASKS.admin);
            });

            it('effect', async function () {
                // Set some previous value
                await this.contracts.manager.connect(this.accounts.admin).setRequirements(target, [ selector ], [ group ]);

                // Check previous value is set
                expect(await this.contracts.manager.getRequirements(target, selector)).to.be.equal(combine(
                    this.MASKS.admin,
                    toMask(group),
                ));

                // Set some new values
                await expect(this.contracts.manager.connect(this.accounts.admin).setRequirements(target, [ selector ], groups))
                .to.emit(this.contracts.manager, 'Requirements').withArgs(target, selector, combine(...groups.map(toMask)));

                // Check the new values are set, and the previous is removed
                expect(await this.contracts.manager.getRequirements(target, selector)).to.be.equal(combine(
                    this.MASKS.admin,
                    ...groups.map(toMask),
                ));
            });
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
                ))
                .to.be.revertedWith('RestrictedAccess').withArgs(this.accounts.other.address, this.contracts.redemption.address, this.contracts.redemption.interface.getSighash('executeRedemption'));
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
                    .to.be.revertedWith('RestrictedAccess').withArgs(this.accounts.other.address, this.contracts.redemption.address, this.contracts.redemption.interface.getSighash('registerOutput'));

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
                    .to.be.revertedWith('RestrictedAccess').withArgs(this.accounts.other.address, this.contracts.redemption.address, this.contracts.redemption.interface.getSighash('registerOutput'));

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

    describe('Upgradeability', function () {
        describe('re-initialize', function () {
            it('manager', async function () {
                await expect(this.contracts.manager.initialize(this.accounts.admin.address))
                .to.be.revertedWith('Initializable: contract is already initialized');
            });

            it('token', async function () {
                await expect(this.contracts.token.initialize('Other Name', 'Other Symbol'))
                .to.be.revertedWith('Initializable: contract is already initialized');
            });

            it('oracle', async function () {
                await expect(this.contracts.oracle.initialize(this.contracts.token.address, 'EUR'))
                .to.be.revertedWith('Initializable: contract is already initialized');
            });

            // Redemption doesn't have an initializer
        });

        describe('upgrade', function () {
            describe('manager', async function () {
                it('authorized', async function () {
                    await ethers.getContractFactory('PermissionManager', this.accounts.admin).then(factory => upgrades.upgradeProxy(
                        this.contracts.manager,
                        factory,
                        { redeployImplementation: 'always' },
                    ));
                });

                it('unauthorized', async function () {
                    await expect(
                        ethers.getContractFactory('PermissionManager', this.accounts.other).then(factory => upgrades.upgradeProxy(
                            this.contracts.manager,
                            factory,
                            { redeployImplementation: 'always' },
                        ))
                    ).to.be.revertedWith('MissingPermissions').withArgs(this.accounts.other.address, this.MASKS.public, this.MASKS.admin);
                });
            });

            describe('token', async function () {
                it('authorized', async function () {
                    await ethers.getContractFactory('Token', this.accounts.admin).then(factory => upgrades.upgradeProxy(
                        this.contracts.token,
                        factory,
                        { redeployImplementation: 'always', constructorArgs: [ this.contracts.manager.address ] },
                    ));
                });

                it('unauthorized', async function () {
                    await expect(
                        ethers.getContractFactory('Token', this.accounts.other).then(factory => upgrades.upgradeProxy(
                            this.contracts.token,
                            factory,
                            { redeployImplementation: 'always', constructorArgs: [ this.contracts.manager.address ] },
                        ))
                    ).to.be.revertedWith('RestrictedAccess').withArgs(this.accounts.other.address, this.contracts.token.address, this.contracts.token.interface.getSighash('upgradeTo'));
                });
            });

            describe('oracle', async function () {
                it('authorized', async function () {
                    await ethers.getContractFactory('Oracle', this.accounts.admin).then(factory => upgrades.upgradeProxy(
                        this.contracts.oracle,
                        factory,
                        { redeployImplementation: 'always', constructorArgs: [ this.contracts.manager.address ] },
                    ));
                });

                it('unauthorized', async function () {
                    await expect(
                        ethers.getContractFactory('Oracle', this.accounts.other).then(factory => upgrades.upgradeProxy(
                            this.contracts.oracle,
                            factory,
                            { redeployImplementation: 'always', constructorArgs: [ this.contracts.manager.address ] },
                        ))
                    ).to.be.revertedWith('RestrictedAccess').withArgs(this.accounts.other.address, this.contracts.oracle.address, this.contracts.oracle.interface.getSighash('upgradeTo'));
                });
            });

            describe('redemption', async function () {
                it('authorized', async function () {
                    await ethers.getContractFactory('Redemption', this.accounts.admin).then(factory => upgrades.upgradeProxy(
                        this.contracts.redemption,
                        factory,
                        { redeployImplementation: 'always', constructorArgs: [ this.contracts.manager.address ] },
                    ));
                });

                it('unauthorized', async function () {
                    await expect(
                        ethers.getContractFactory('Redemption', this.accounts.other).then(factory => upgrades.upgradeProxy(
                            this.contracts.redemption,
                            factory,
                            { redeployImplementation: 'always', constructorArgs: [ this.contracts.manager.address ] },
                        ))
                    ).to.be.revertedWith('RestrictedAccess').withArgs(this.accounts.other.address, this.contracts.redemption.address, this.contracts.redemption.interface.getSighash('upgradeTo'));
                });
            });
        });
    });
});
