import { MitosisComponent, MitosisImport } from 'src/types/mitosis-component';
import { getImportValue } from '../../helpers/render-imports';
import { AureliaVersion, ImportValues, ToAureliaOptions } from './types';

export const DEFAULT_AURELIA_VERSION: AureliaVersion = 1;
export const IMPORT_MARKER = '[[MARKER]]';
export const MARKER_JS_MAPPED = '[[JS_MARKER]]';

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
    const importValue = getImportValue(importedValues);

    const templateMapped = importValue
      ? `${IMPORT_MARKER}<require from="${path}"></require>`
      : `import '${path}';`;

    let jsMapped = '';
    if (importValue) {
      let replaced = importValue;
      componentsUsed.forEach((componentName) => {
        replaced = replaced.replace(`${componentName},`, '');
        replaced = replaced.replace(`, ${componentName}`, '');
        replaced = replaced.replace(`,${componentName}`, '');
      });
      jsMapped = `import ${replaced} from '${path}';`;
    } else {
      jsMapped = `import '${path}';`;
    }

    const finalMapped = `${templateMapped}${MARKER_JS_MAPPED}${jsMapped}`;
    return finalMapped;
  },
};
