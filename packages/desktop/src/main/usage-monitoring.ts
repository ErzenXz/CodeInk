import { getStore } from "./store"
import { USAGE_MONITORING_ENABLED_KEY } from "./store-keys"

const listeners = new Set<() => void>()

export function usageMonitoringEnabled() {
  return getStore().get(USAGE_MONITORING_ENABLED_KEY) === true
}

export function setUsageMonitoringEnabled(enabled: boolean) {
  getStore().set(USAGE_MONITORING_ENABLED_KEY, enabled)
  listeners.forEach((listener) => listener())
  return enabled
}

export function subscribeUsageMonitoring(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
