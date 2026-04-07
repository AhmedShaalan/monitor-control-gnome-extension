// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2025 Ahmed Shaalan

import {castInt} from './utils.js'

export class DdcutilHelper {

  constructor (ddcutilWrapper) {
    this._ddcutil = ddcutilWrapper
  }

  // get the list of all I2C buses and values with a valid response to
  // this getvcp request
  async _getVcpValid (code, bus_list, retry = 1) {
    const values = await Promise.all(bus_list.map(
      async (bus) => [bus, await this._ddcutil.getvcp(code, bus, retry)]))
    const valid = values.filter(v => v[1] !== null && v[1] !== 'ERR')
    return Object.fromEntries(valid)
  }

  // run setvcp with given code and value on all specified I2C buses,
  // scale the value to the bus_maxrng of the bus, and return the list
  // of buses where the command failed
  async _setVcpAllScaleInt (code, value, bus_maxrng, bus_list) {
    const results = await Promise.all(
      bus_list.map(async (bus) => {
        const ok = await this._ddcutil.setvcp(
          code,
          castInt(value * (bus_maxrng[bus] / 100)).toString(),
          bus)
        return ok ? null : bus
      }))
    return results.filter(bus => bus !== null)
  }
}
