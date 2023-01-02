import { OmitObj } from '../../helpers/typescript';
import { BaseTranspilerOptions } from '../../types/transpiler';
import { MitosisImport } from '../../types/mitosis-component';

export type AureliaVersion = 1 | 2;
export const AureliaV1 = 1;
export const AureliaV2 = 2;

interface AureliaVersionOpt {
  aureliaVersion: AureliaVersion;
}

export interface ToAureliaOptions extends BaseTranspilerOptions, AureliaVersionOpt {
  importMapper?: Function;
  // cssNamespace?: () => string;
  // namePrefix?: (path: string) => string;
  // asyncComponentImports?: boolean;
  // api: Api;
}

export type AureliaOptsWithoutVersion = OmitObj<ToAureliaOptions, AureliaVersionOpt>;

export interface ImportValues {
  starImport: string | null;
  defaultImport: string | null;
  namedImports: string | null;
}

export interface ImportData {
  name: string;
  path: string;
  templatePath: string;
  jsPath: string;
  imports: MitosisImport['imports'];
}
