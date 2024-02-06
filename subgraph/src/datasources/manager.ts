import { store, Bytes } from '@graphprotocol/graph-ts'

import { events, transactions } from '@amxx/graphprotocol-utils'
import { fetchAccount  } from '@openzeppelin/subgraphs/src/fetch/account'

import {
	Group,
	Membership,
	Requirement,
	GroupAdded,
	GroupRemoved,
} from '../../generated/schema'

import {
	GroupAdded   as GroupAddedEvent,
	GroupAdmins  as GroupAdminsEvent,
	GroupRemoved as GroupRemovedEvent,
	Requirements as RequirementsEvent,
} from '../../generated/manager/PermissionManager'

function fetchGroup(g: i32): Group {
	const id = g.toString()
	let group = Group.load(id)
	if (group == null) {
		group = new Group(id)
		group.admins = []
		group.save()
	}
	return group
}

export function handleGroupAdded(event: GroupAddedEvent): void {
	const membership = new Membership(event.params.group.toString().concat('-').concat(event.params.user.toHex()))
	membership.user  = fetchAccount(event.params.user).id
	membership.group = fetchGroup(event.params.group).id
	membership.save()

	let ev         = new GroupAdded(events.id(event))
	ev.emitter     = fetchAccount(event.address).id
	ev.transaction = transactions.log(event).id
	ev.timestamp   = event.block.timestamp
	ev.user        = membership.user
	ev.group       = membership.group
	ev.save()
}

export function handleGroupRemoved(event: GroupRemovedEvent): void {
	store.remove('Membership', event.params.group.toString().concat('-').concat(event.params.user.toHex()))

	let ev         = new GroupRemoved(events.id(event))
	ev.emitter     = fetchAccount(event.address).id
	ev.transaction = transactions.log(event).id
	ev.timestamp   = event.block.timestamp
	ev.user        = fetchAccount(event.params.user).id
	ev.group       = fetchGroup(event.params.group).id
	ev.save()
}

function extractGroups(groups: Bytes): Array<string> {
	const result = new Array<string>()
	for (let i = 0; i < 32; ++i) {
		const bucket = groups.at(31 - i) || 0
		if ((bucket & 0x01) != 0) result.push(fetchGroup(i * 8 + 1).id)
		if ((bucket & 0x02) != 0) result.push(fetchGroup(i * 8 + 2).id)
		if ((bucket & 0x04) != 0) result.push(fetchGroup(i * 8 + 3).id)
		if ((bucket & 0x08) != 0) result.push(fetchGroup(i * 8 + 4).id)
		if ((bucket & 0x10) != 0) result.push(fetchGroup(i * 8 + 5).id)
		if ((bucket & 0x20) != 0) result.push(fetchGroup(i * 8 + 6).id)
		if ((bucket & 0x40) != 0) result.push(fetchGroup(i * 8 + 7).id)
		if ((bucket & 0x80) != 0) result.push(fetchGroup(i * 8 + 8).id)
	}
	return result
}

export function handleRequirements(event: RequirementsEvent): void {
	const requirements    = new Requirement(event.params.target.toHex().concat('-').concat(event.params.selector.toHex()))
	requirements.target   = fetchAccount(event.params.target).id
	requirements.selector = event.params.selector
	requirements.groups   = extractGroups(event.params.groups)
	requirements.save()

	// TODO: event?
}

export function handleGroupAdmins(event: GroupAdminsEvent): void {
	const group     = fetchGroup(event.params.group)
	group.admins    = extractGroups(event.params.admins)
	group.save()

	// TODO: event?
}
