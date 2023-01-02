import { componentToAurelia } from './generate';
import { AureliaOptsWithoutVersion } from './types';

export const componentToAurelia1 = (aureliaOptions?: AureliaOptsWithoutVersion) =>
  componentToAurelia({ ...aureliaOptions, aureliaVersion: 1 });

export const componentToAurelia2 = (aureliaOptions?: AureliaOptsWithoutVersion) =>
  componentToAurelia({ ...aureliaOptions, aureliaVersion: 2 });
