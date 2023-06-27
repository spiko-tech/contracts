require('chai').use(require('ethereum-waffle').solidity);

const { expect }           = require('chai');
const { ethers, upgrades } = require('hardhat');
const { loadFixture }      = require('@nomicfoundation/hardhat-network-helpers');

const toHexString = i => '0x' + i.toString(16).padStart(64, 0);
const combine = (...masks) => toHexString(masks.reduce((acc, m) => acc | BigInt(m), 0n));

const GROUPS = Array(256);
GROUPS[0]    = 'ADMIN'
GROUPS[1]    = 'OPERATOR'
GROUPS[2]    = 'WHITELISTER'
GROUPS[3]    = 'WHITELISTED'
GROUPS[255]  = 'PUBLIC';
const MASKS  = GROUPS.map((_, i) => toHexString(1n << BigInt(i)));
Object.assign(GROUPS, Object.fromEntries(GROUPS.map((key, i) => [ key, i ]).filter(Boolean)));
Object.assign(MASKS, Object.fromEntries(GROUPS.map((key, i) => [ key, MASKS[i] ]).filter(Boolean)));

const name   = 'Token Name';
const symbol = 'Sym';

async function migrate() {
    const accounts       = await ethers.getSigners();
    accounts.admin       = accounts.shift();
    accounts.operator    = accounts.shift();
    accounts.whitelister = accounts.shift();
    accounts.alice       = accounts.shift();
    accounts.bruce       = accounts.shift();
    accounts.chris       = accounts.shift();
    accounts.other       = accounts.shift();

    const manager = await ethers.getContractFactory('PermissionManager')
        .then(factory  => factory.deploy(accounts.admin.address))
        .then(contract => contract.deployed());

    const token = await ethers.getContractFactory('Token')
        .then(factory => upgrades.deployProxy(factory, [ name, symbol ], { constructorArgs: [ manager.address ] }))

    // set group admins
    await manager.connect(accounts.admin      ).setGroupAdmins(GROUPS.OPERATOR,    [ GROUPS.ADMIN       ]);
    await manager.connect(accounts.admin      ).setGroupAdmins(GROUPS.WHITELISTER, [ GROUPS.ADMIN       ]);
    await manager.connect(accounts.admin      ).setGroupAdmins(GROUPS.WHITELISTED, [ GROUPS.WHITELISTER ]);

    // populate groups
    await manager.connect(accounts.admin      ).addGroup(accounts.operator.address,    GROUPS.OPERATOR);
    await manager.connect(accounts.admin      ).addGroup(accounts.whitelister.address, GROUPS.WHITELISTER);
    await manager.connect(accounts.whitelister).addGroup(accounts.alice.address,       GROUPS.WHITELISTED);
    await manager.connect(accounts.whitelister).addGroup(accounts.bruce.address,       GROUPS.WHITELISTED);

    // restricted functions
    const perms = Object.entries({
        upgradeTo: [ GROUPS.ADMIN       ],
        mint:      [ GROUPS.OPERATOR    ],
        burn:      [ GROUPS.OPERATOR    ],
        pause:     [ GROUPS.OPERATOR    ],
        unpause:   [ GROUPS.OPERATOR    ],
        transfer:  [ GROUPS.WHITELISTED ],
    }).reduce((acc, [ k, v ]) => { acc[v] ??= []; acc[v].push(token.interface.getSighash(k)); return acc; }, {});

    await manager.multicall(
        Object.entries(perms).map(([ group, selectors ]) => manager.interface.encodeFunctionData('setRequirements', [
            token.address,
            selectors,
            [ group ],
        ]))
    );

    return { accounts, manager, token };
}

describe('Main', function () {
    beforeEach(async function () {
        await loadFixture(migrate).then(fixture => Object.assign(this, fixture));
    });

    it('post deployment state', async function () {
        expect(await this.token.name()).to.be.equal(name);
        expect(await this.token.symbol()).to.be.equal(symbol);
        expect(await this.token.totalSupply()).to.be.equal(0);
        expect(await this.manager.ADMIN()).to.be.equal(MASKS.ADMIN);
        expect(await this.manager.PUBLIC()).to.be.equal(MASKS.PUBLIC);
    });

    it('accounts have permissions', async function () {
        expect(await this.manager.getGroups(this.accounts.admin.address      )).to.be.equal(combine(MASKS.PUBLIC, MASKS.ADMIN));
        expect(await this.manager.getGroups(this.accounts.operator.address   )).to.be.equal(combine(MASKS.PUBLIC, MASKS.OPERATOR));
        expect(await this.manager.getGroups(this.accounts.whitelister.address)).to.be.equal(combine(MASKS.PUBLIC, MASKS.WHITELISTER));
        expect(await this.manager.getGroups(this.accounts.alice.address      )).to.be.equal(combine(MASKS.PUBLIC, MASKS.WHITELISTED));
        expect(await this.manager.getGroups(this.accounts.bruce.address      )).to.be.equal(combine(MASKS.PUBLIC, MASKS.WHITELISTED));
        expect(await this.manager.getGroups(this.accounts.chris.address      )).to.be.equal(combine(MASKS.PUBLIC));
    });

    it('functions have requirements', async function () {
        expect(await this.manager.getRequirements(this.token.address, this.token.interface.getSighash('upgradeTo'))).to.be.equal(combine(MASKS.ADMIN));
        expect(await this.manager.getRequirements(this.token.address, this.token.interface.getSighash('mint'     ))).to.be.equal(combine(MASKS.OPERATOR));
        expect(await this.manager.getRequirements(this.token.address, this.token.interface.getSighash('burn'     ))).to.be.equal(combine(MASKS.OPERATOR));
        expect(await this.manager.getRequirements(this.token.address, this.token.interface.getSighash('pause'    ))).to.be.equal(combine(MASKS.OPERATOR));
        expect(await this.manager.getRequirements(this.token.address, this.token.interface.getSighash('unpause'  ))).to.be.equal(combine(MASKS.OPERATOR));
        expect(await this.manager.getRequirements(this.token.address, this.token.interface.getSighash('transfer' ))).to.be.equal(combine(MASKS.WHITELISTED));
    });

    describe('Token', function () {
        describe('ERC20', function () {
            describe('mint', function () {
                it('authorized', async function () {
                    await expect(this.token.connect(this.accounts.operator).mint(this.accounts.alice.address, 1000))
                    .to.emit(this.token, 'Transfer').withArgs(ethers.constants.AddressZero, this.accounts.alice.address, 1000);
                });

                it('unauthorized caller (need operator)', async function () {
                    await expect(this.token.connect(this.accounts.alice).mint(this.accounts.alice.address, 1000))
                    .to.be.revertedWith('Restricted access');
                });

                it('unauthorized to (need whitelisted)', async function () {
                    await expect(this.token.connect(this.accounts.operator).mint(this.accounts.chris.address, 1000))
                    .to.be.revertedWith('unauthorized to');
                });
            });

            describe('burn', function () {
                beforeEach(async function () {
                    await this.token.connect(this.accounts.operator).mint(this.accounts.alice.address, 1000)
                });

                it('authorized', async function () {
                    await expect(this.token.connect(this.accounts.operator).burn(this.accounts.alice.address, 100))
                    .to.emit(this.token, 'Transfer').withArgs(this.accounts.alice.address, ethers.constants.AddressZero, 100);
                });

                it('unauthorized caller (need operator)', async function () {
                    await expect(this.token.connect(this.accounts.alice).burn(this.accounts.alice.address, 1000))
                    .to.be.revertedWith('Restricted access');
                });

                it('unauthorized from (need whitelisted)', async function () {
                    await expect(this.token.connect(this.accounts.operator).burn(this.accounts.chris.address, 1000))
                    .to.be.revertedWith('unauthorized from');
                });
            });

            describe('transfers', function () {
                beforeEach(async function () {
                    this.mock = await ethers.getContractFactory('ERC1363ReceiverMock')
                        .then(factory  => factory.deploy())
                        .then(contract => contract.deployed());

                    await this.token.connect(this.accounts.operator).mint(this.accounts.alice.address, 1000);
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
                                operator && await this.token.connect(from).approve(operator.address, amount);
                                await this.manager.connect(this.accounts.whitelister)[fromAuthorized ? 'addGroup' : 'remGroup'](from.address, GROUPS.WHITELISTED);
                                await this.manager.connect(this.accounts.whitelister)[toAuthorized   ? 'addGroup' : 'remGroup'](to.address,   GROUPS.WHITELISTED);

                                let promise = null;
                                switch(fn) {
                                    case 'transfer':
                                        promise = this.token.connect(from).transfer(to.address, amount)
                                        break;
                                    case 'transferFrom':
                                        promise = this.token.connect(operator).transferFrom(from.address, to.address, amount);
                                        break;
                                    case 'transferAndCall':
                                        promise = this.token.connect(from)['transferAndCall(address,uint256)'](to.address, amount);
                                        break;
                                    case 'transferFromAndCall':
                                        promise = this.token.connect(operator)['transferFromAndCall(address,address,uint256)'](from.address, to.address, amount);
                                        break;
                                }

                                (fromAuthorized && toAuthorized)
                                    ? await expect(promise).to.emit(this.token, 'Transfer').withArgs(from.address, to.address, amount)
                                    : await expect(promise).to.be.revertedWith((!fromAuthorized && 'unauthorized from') || (!toAuthorized && 'unauthorized to'));
                            });
                        }
                    });
            });

            describe('pause', function () {
                it('authorized', async function () {
                    await expect(this.token.connect(this.accounts.operator).pause())
                    .to.emit(this.token, 'Paused').withArgs(this.accounts.operator.address);
                });

                it('unauthorized caller (need operator)', async function () {
                    await expect(this.token.connect(this.accounts.alice).pause())
                    .to.be.revertedWith('Restricted access');
                });

                it('pausing disables transfers', async function () {
                    await this.token.connect(this.accounts.operator).pause();

                    await expect(this.token.connect(this.accounts.alice).transfer(this.accounts.bruce.address, 0))
                    .to.be.revertedWith('ERC20Pausable: token transfer while paused');
                });
            });

            describe('unpause', function () {
                beforeEach(async function () {
                    await this.token.connect(this.accounts.operator).pause();
                });

                it('authorized', async function () {
                    await expect(this.token.connect(this.accounts.operator).unpause())
                    .to.emit(this.token, 'Unpaused').withArgs(this.accounts.operator.address);
                });

                it('unauthorized caller (need operator)', async function () {
                    await expect(this.token.connect(this.accounts.alice).unpause())
                    .to.be.revertedWith('Restricted access');
                });

                it('unpausing re-enables transfers', async function () {
                    await this.token.connect(this.accounts.operator).unpause();

                    await expect(this.token.connect(this.accounts.alice).transfer(this.accounts.bruce.address, 0))
                    .to.emit(this.token, 'Transfer').withArgs(this.accounts.alice.address, this.accounts.bruce.address, 0);
                });
            });
        });
    });
});
