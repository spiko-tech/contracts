import { events, transactions } from '@amxx/graphprotocol-utils'
import { fetchAccount         } from '@openzeppelin/subgraphs/src/fetch/account'

import {
	ERC20Contract,
	MorphoMarket,
	MorphoLiquidation,
} from '../../generated/schema'

import {
	CreateMarket as CreateMarketEvent,
	Liquidate    as LiquidateEvent,
} from '../../generated/morpho/Morpho'


export function handleCreateMarket(event: CreateMarketEvent): void {
	const loan = ERC20Contract.load(event.params.marketParams.loanToken);

	if (loan != null) {
		const market      = new MorphoMarket(event.params.id);
		market.loan       = loan.id
		market.collateral = fetchAccount(event.params.marketParams.collateralToken).id
		market.save()
	}
}

export function handleLiquidate(event: LiquidateEvent): void {
	const market = MorphoMarket.load(event.params.id)

	if (market != null) {
		let ev           = new MorphoLiquidation(events.id(event))
		ev.emitter       = fetchAccount(event.address).id
		ev.transaction   = transactions.log(event).id
		ev.timestamp     = event.block.timestamp
		ev.market        = market.id
		ev.caller        = fetchAccount(event.params.caller).id
		ev.borrower      = fetchAccount(event.params.borrower).id
		ev.repaidAssets  = event.params.repaidAssets
		ev.repaidShares  = event.params.repaidShares
		ev.seizedAssets  = event.params.seizedAssets
		ev.badDebtAssets = event.params.badDebtAssets
		ev.badDebtShares = event.params.badDebtShares
		ev.save()
	}
}
