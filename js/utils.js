// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2025 Ahmed Shaalan

export const LOG = msg => console.log('### monitor-control@ahmed-shaalan ### ' + msg)

export const castInt = num => ~~num

export const isEmpty = obj => {
  for (const x in obj)
    return false
  return true
}

export const avgVM = arr => arr
  .reduce((a, b) => [100 * (a[0] / a[1] + b[0] / b[1]), 100])[0] / arr.length

let activeTimeouts = {}
export const setTimeoutTracked = (ref, delay, ...params) => {
  let timeoutId
  timeoutId = setTimeout((...params) => {
    delete activeTimeouts[timeoutId]
    ref(...params)
  }, delay, ...params)
  activeTimeouts[timeoutId] = 1
}

export const clearAllTimeouts = () => {
  for (const timeoutId of Object.keys(activeTimeouts))
    clearTimeout(timeoutId)
  activeTimeouts = {}
}

export const sleep = ms => new Promise(resolve => setTimeoutTracked(resolve, ms))
