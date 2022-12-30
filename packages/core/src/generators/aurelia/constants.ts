import { MitosisComponent, MitosisImport } from 'src/types/mitosis-component';
import { getImportValue } from '../../helpers/render-imports';
import { AureliaVersion, ImportValues, ToAureliaOptions } from './types';

export const DEFAULT_AURELIA_VERSION: AureliaVersion = 1;
export const IMPORT_MARKER = '[[MARKER]]';

export const DEFAULT_AURELIA_OPTIONS: ToAureliaOptions = {
  aureliaVersion: DEFAULT_AURELIA_VERSION,

  importMapper: (
    // ...args
    component: MitosisComponent | null | undefined,
    theImport: MitosisImport,
    importedValues: ImportValues,
    componentsUsed: string[],
    path: string,
  ) => {
    theImport; /*?*/
    //  args/*?*/
    const importValue = getImportValue(importedValues);

    const mapped = importValue
      ? `${IMPORT_MARKER}<require from="${path}"></require>`
      : `import '${path}';`;

    return mapped;
  },
};
