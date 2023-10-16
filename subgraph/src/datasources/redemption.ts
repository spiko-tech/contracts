import { store } from '@graphprotocol/graph-ts'

import { decimals, events, transactions } from '@amxx/graphprotocol-utils'
import { fetchAccount  } from '@openzeppelin/subgraphs/src/fetch/account'
import { fetchERC20    } from '@openzeppelin/subgraphs/src/fetch/erc20'

import {
	IOPair,
	Redemption,
	RedemptionInitiated,
	RedemptionExecuted,
	RedemptionCanceled,
} from '../../generated/schema'

import {
	RedemptionInitiated as RedemptionInitiatedEvent,
	RedemptionExecuted  as RedemptionExecutedEvent,
	RedemptionCanceled  as RedemptionCanceledEvent,
	EnableOutput        as EnableOutputEvent,
} from '../../generated/redemption/Redemption'

export function handleRedemptionInitiated(event: RedemptionInitiatedEvent): void {
	const input  = fetchERC20(event.params.input);
	const output = fetchERC20(event.params.output);

	let redemption             = new Redemption(event.params.id);
	redemption.status          = 'INITIATED'
	redemption.user            = fetchAccount(event.params.user).id
	redemption.input           = input.id
	redemption.inputValue      = decimals.toDecimals(event.params.inputValue, input.decimals)
	redemption.inputValueExact = event.params.inputValue
	redemption.output          = output.id
	redemption.salt            = event.params.salt
	redemption.save()

	let ev         = new RedemptionInitiated(events.id(event))
	ev.emitter     = fetchAccount(event.address).id
	ev.transaction = transactions.log(event).id
	ev.timestamp   = event.block.timestamp
	ev.redemption  = redemption.id
	ev.save()
}

export function handleRedemptionExecuted(event: RedemptionExecutedEvent): void {
	let ev         = new RedemptionExecuted(events.id(event))
	ev.emitter     = fetchAccount(event.address).id
	ev.transaction = transactions.log(event).id
	ev.timestamp   = event.block.timestamp
	ev.redemption  = event.params.id
	ev.data        = event.params.data
	ev.save()
}

export function handleRedemptionCanceled(event: RedemptionCanceledEvent): void {
	let ev         = new RedemptionCanceled(events.id(event))
	ev.emitter     = fetchAccount(event.address).id
	ev.transaction = transactions.log(event).id
	ev.timestamp   = event.block.timestamp
	ev.redemption  = event.params.id
	ev.save()
}

export function handleEnableOutput(event: EnableOutputEvent): void {
	const id = event.params.input.toHex().concat("-").concat(event.params.output.toHex())

	if (event.params.enable) {
		const iopair  = new IOPair(id)
		iopair.input  = fetchERC20(event.params.input).id
		iopair.output = fetchERC20(event.params.output).id
		iopair.save()
	} else {
		store.remove('IOPair', id)
	}
}
