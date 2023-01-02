import { MitosisComponent, MitosisImport } from 'src/types/mitosis-component';
import { getImportValue } from '../../helpers/render-imports';
import { AureliaVersion, ImportValues, ToAureliaOptions } from './types';

export const DEFAULT_AURELIA_VERSION: AureliaVersion = 1;
export const IMPORT_MARKER = '[[MARKER]]';
export const MARKER_JS_MAPPED = '[[JS_MARKER]]';
export const MARKER_JSON_ITEM = '[[JSON_MARKER]]';

export const DEFAULT_AURELIA_OPTIONS: ToAureliaOptions = {
  aureliaVersion: DEFAULT_AURELIA_VERSION,

  importMapper: (
    // ...args
    component: MitosisComponent | null | undefined,
    theImport: MitosisImport,
    importedValues: ImportValues,
    componentsUsed: string[],
    path: string,
  ): string => {
    const importValue = getImportValue(importedValues);
    // /* prettier-ignore */ console.log('------------------------------------------------------------------------------------------')
    // importValue; /*?*/
    // importedValues; /*?*/
    // theImport; /*?*/

    const templateMapped = importValue
      ? `${IMPORT_MARKER}<require from="${path}"></require>`
      : `import '${path}';`;

    let jsMapped = '';
    let replaced = importValue;
    if (importValue) {
      componentsUsed.forEach((componentName) => {
        replaced = replaced.replace(`${componentName},`, '');
        replaced = replaced.replace(`, ${componentName}`, '');
        replaced = replaced.replace(`,${componentName}`, '');
      });
      jsMapped = `import ${replaced} from '${path}';`;
    } else {
      jsMapped = `import '${path}';`;
    }

    let result = JSON.stringify({
      name: replaced,
      path: path,
      templatePath: templateMapped,
      jsPath: jsMapped,
      imports: theImport.imports,
    });
    result += MARKER_JSON_ITEM;
    // result; /*?*/
    return result;
  },
};
