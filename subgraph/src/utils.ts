import { ethereum } from "@graphprotocol/graph-ts";

export function unwrapWithFallback<T>(call: ethereum.CallResult<T>, fallback: T): T {
	return call.reverted ? fallback : call.value
}