import { OmitObj } from '../../helpers/typescript';
import { BaseTranspilerOptions } from '../../types/transpiler';

export type AureliaVersion = 1 | 2;

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
