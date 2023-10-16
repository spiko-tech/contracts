import { decimals, events, transactions } from '@amxx/graphprotocol-utils'
import { fetchAccount } from '@openzeppelin/subgraphs/src/fetch/account'
import { fetchERC20   } from '@openzeppelin/subgraphs/src/fetch/erc20'

import {
	PriceUpdate,
} from '../../generated/schema'

import {
	Oracle as OracleContract,
	Update as UpdateEvent,
} from '../../generated/oracle/Oracle'

export function handleUpdate(event: UpdateEvent): void {
	const tokenAddress = OracleContract.bind(event.address).try_token()
	if (!tokenAddress.reverted) {
		const token    = fetchERC20(tokenAddress.value)

		let ev         = new PriceUpdate(events.id(event))
		ev.emitter     = fetchAccount(event.address).id
		ev.transaction = transactions.log(event).id
		ev.timestamp   = event.block.timestamp
		ev.timepoint   = event.params.timepoint
		ev.token       = token.id
		ev.price       = decimals.toDecimals(event.params.price, token.decimals)
		ev.priceExact  = event.params.price
		ev.save()
	}
}
