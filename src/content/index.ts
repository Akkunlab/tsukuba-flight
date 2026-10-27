import { VEHICLES } from './vehicles';
import { FUELS } from './fuels';
import { PASSENGERS } from './passengers';
import { MODES } from './modes';
import { SCENERY } from './scenery';
import evolutionLog from './evolution-log.json';
import type { EvolutionEntry, FuelDef, ModeDef, PassengerDef, VehicleDef } from './types';

export { VEHICLES, FUELS, PASSENGERS, MODES, SCENERY };
export const EVOLUTION_LOG = evolutionLog as EvolutionEntry[];
export const GENERATION = Math.max(...EVOLUTION_LOG.map((e) => e.generation));

/** 1 回のフライトで乗せられる搭乗者の数 */
export const MAX_PASSENGERS = 3;

export function vehicleById(id: string): VehicleDef {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
}
export function fuelById(id: string): FuelDef {
  return FUELS.find((f) => f.id === id) ?? FUELS[0];
}
export function modeById(id: string): ModeDef {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}
export function fuelsFor(v: VehicleDef): FuelDef[] {
  return v.fuels ? FUELS.filter((f) => v.fuels!.includes(f.id)) : FUELS.filter((f) => f.id !== 'water');
}
export function passengerById(id: string, custom: PassengerDef[] = []): PassengerDef | undefined {
  return PASSENGERS.find((p) => p.id === id) ?? custom.find((p) => p.id === id);
}
