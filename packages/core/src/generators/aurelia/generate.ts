const DEBUG = false;

import dedent from 'dedent';
import { format } from 'prettier/standalone';
import { collectCss } from '../../helpers/styles/collect-css';
import { fastClone } from '../../helpers/fast-clone';
import { getRefs } from '../../helpers/get-refs';
import {
  getStateObjectStringFromComponent,
  stringifyContextValue,
} from '../../helpers/get-state-object-string';
import { mapRefs } from '../../helpers/map-refs';
import { renderPreComponent } from '../../helpers/render-imports';
import {
  DO_NOT_USE_VARS_TRANSFORMS,
  stripStateAndPropsRefs,
} from '../../helpers/strip-state-and-props-refs';
import { selfClosingTags } from '../../parsers/jsx';
import { checkIsForNode, MitosisNode } from '../../types/mitosis-node';
import {
  runPostCodePlugins,
  runPostJsonPlugins,
  runPreCodePlugins,
  runPreJsonPlugins,
} from '../../modules/plugins';
import isChildren from '../../helpers/is-children';
import { getProps } from '../../helpers/get-props';
import { getPropsRef } from '../../helpers/get-props-ref';
import { filter, isString, kebabCase } from 'lodash';
import { stripMetaProperties } from '../../helpers/strip-meta-properties';
import { removeSurroundingBlock } from '../../helpers/remove-surrounding-block';
import { TranspilerGenerator } from '../../types/transpiler';
import { indent } from '../../helpers/indent';
import { isSlotProperty, stripSlotPrefix } from '../../helpers/slots';
import { getCustomImports } from '../../helpers/get-custom-imports';
import { getComponentsUsed } from '../../helpers/get-components-used';
import { isUpperCase } from '../../helpers/is-upper-case';
import { replaceIdentifiers } from '../../helpers/replace-identifiers';
import { VALID_HTML_TAGS } from '../../constants/html_tags';
import { flow, pipe } from 'fp-ts/lib/function';

import { isMitosisNode, MitosisComponent } from '../..';
import { mergeOptions } from '../../helpers/merge-options';
import { CODE_PROCESSOR_PLUGIN } from '../../helpers/plugins/process-code';
import { AureliaV1, ImportData, ToAureliaOptions } from './types';
import { DEFAULT_AURELIA_OPTIONS, MARKER_JSON_ITEM } from './constants';
import { encodeQuotes } from '../vue/helpers';
import { stripStateAndProps } from './helpers';

const BUILT_IN_COMPONENTS = new Set(['Show', 'For', 'Fragment', 'Slot']);
const IS_DEV = true;

enum BuiltInEnums {
  'Show' = 'Show',
  'For' = 'For',
  'Fragment' = 'Fragment',
  'Slot' = 'Slot',
  'Radio' = 'radio',
  'Checkbox' = 'checkbox',
  'Checked' = 'checked',
}

enum BuiltInKeywords {
  'else' = 'else',
}

enum AureliaKeywords {
  'Else' = 'else',
  'If' = 'if',
  'Require' = 'require',
  'import' = 'import',
  'Tempalte' = 'template',
}

enum CallLocation {
  Start = 'Start',
  For = 'For',
  Show = 'Show',
  Else = 'Else',
  Fragment = 'Fragment',
  Slot = 'Slot',
  Children = 'Children',
  ChildrenForTemplate = 'ChildrenForTemplate',
}

interface AureliaBlockOptions {
  childComponents?: string[];
  /**
   * Because of recursion, this is a helper property to see where in the recursion step we are
   */
  callLocation: CallLocation;
  /**
   * Aurelia does not name the index in For elements (repeat-for),
   * thus keep track of all the indexNames, to then later replace with `$index`
   */
  indexNameTracker?: string[];
  /** Aurelia needs to explicitly set the eg. React props as @bindable */
  spreadCollector?: string[];
  allClassVars?: string[];
}

const mappers: {
  [key: string]: (
    json: MitosisNode,
    options: ToAureliaOptions,
    blockOptions: AureliaBlockOptions,
  ) => string;
} = {
  Fragment: (json, options, blockOptions) => {
    return `${json.children
      .map((item) =>
        blockToAurelia(item, options, { ...blockOptions, callLocation: CallLocation.Fragment }),
      )
      .join('\n')}`;
  },
  Slot: (json, options, blockOptions) => {
    const renderChildren = () =>
      json.children
        ?.map((item) =>
          blockToAurelia(item, options, { ...blockOptions, callLocation: CallLocation.Slot }),
        )
        .join('\n');
    const renderedChildren = renderChildren();

    return `\n<slot ${Object.entries({ ...json.bindings, ...json.properties })
      .map(([binding, value]) => {
        if (value && binding === 'name') {
          const selector = pipe(isString(value) ? value : value.code, stripSlotPrefix, kebabCase);
          // Step: Slot
          return `name="${selector}"`;
        }
      })
      .join('\n')}>${Object.entries(json.bindings)
      .map(([binding, value]) => {
        if (value && binding !== 'name') {
          return value.code;
        }
      })
      .join('\n')}${renderedChildren}</slot>`;
  },
};

// TODO: Maybe in the future allow defining `string | function` as values
const BINDINGS_MAPPER: { [key: string]: string | undefined } = {
  innerHTML: 'innerHTML',
  style: 'style',
};

export const blockToAurelia = (
  json: MitosisNode,
  options: ToAureliaOptions = DEFAULT_AURELIA_OPTIONS,
  blockOptions: AureliaBlockOptions = {
    callLocation: CallLocation.Start,
    indexNameTracker: [],
    spreadCollector: [],
    allClassVars: [],
  },
): string => {
  // blockOptions.callLocation; /*?*/
  // json.name; /*?*/
  const isValidHtmlTag = VALID_HTML_TAGS.includes(json.name.trim());

  if (mappers[json.name]) {
    return mappers[json.name](json, options, blockOptions);
  }

  if (isChildren({ node: json })) {
    return `<slot></slot>`;
  }

  if (json.properties._text) {
    return json.properties._text;
  }

  // Step: text
  const textCode = json.bindings._text?.code;
  if (textCode) {
    let result = '';
    if (isSlotProperty(textCode)) {
      const selector = pipe(textCode, stripSlotPrefix, kebabCase);
      return `<slot select="[${selector}]"></slot>`;
    }

    if (blockOptions.indexNameTracker?.includes(textCode)) {
      // Step: $index
      result = '';
      result += `\${$index}`;
      if (DEBUG) {
        result += '--[[$index]]--';
      }
      return result;
    }

    // Step: text interpolation
    result = '';
    result += `\${${textCode}}`;
    if (DEBUG) {
      result += '--[[text]]--';
    }
    return result;
  }

  let str = '';

  const needsToRenderSlots = [];

  if (checkIsForNode(json)) {
    // Step: For / Step: Repeat for
    str += `<${AureliaKeywords.Tempalte} repeat.for="${json.scope.forName} of ${json.bindings.each?.code}">`;
    if (DEBUG) {
      str += '--[[For]]--';
    }

    // Step: $index
    if (!blockOptions.indexNameTracker) {
      blockOptions.indexNameTracker = [];
    }
    const indexName = json.scope.indexName;
    if (indexName) {
      blockOptions.indexNameTracker.push(indexName);
    }

    str += json.children
      .map((item) =>
        blockToAurelia(item, options, { ...blockOptions, callLocation: CallLocation.For }),
      )
      .join('\n');
    str += `</${AureliaKeywords.Tempalte}>`;
  } else if (json.name === BuiltInEnums.Show) {
    str += `<${AureliaKeywords.Tempalte} ${AureliaKeywords.If}.bind="${json.bindings.when?.code}">`;
    str += json.children
      .map((item) => {
        return blockToAurelia(item, options, { ...blockOptions, callLocation: CallLocation.Show });
      })
      .join('\n');
    str += `</${AureliaKeywords.Tempalte}>`;

    if (isMitosisNode(json.meta.else)) {
      str += `<${AureliaKeywords.Tempalte} ${AureliaKeywords.Else}>
      ${blockToAurelia(json.meta.else, options, {
        ...blockOptions,
        callLocation: CallLocation.Else,
      })}
      </${AureliaKeywords.Tempalte}>`;
    }
  } else {
    // json.name; /*?*/
    const elSelector = kebabCase(json.name);

    // Step: Opening Tag
    str += `<${elSelector}`;

    for (const key in json.properties) {
      if (key.startsWith('$')) {
        continue;
      }
      const value = json.properties[key];
      str += ` ${key}="${value}" `;
    }
    for (const key in json.bindings) {
      if (json.bindings[key]?.type === 'spread') {
        let spreads = filter(json.bindings, (binding) => binding?.type === 'spread').map(
          (value) => value?.code,
        );

        // Step: Spread
        if (spreads?.length) {
          // if (spreads.length > 1) {
          //   let spreadsString = `{...${spreads.join(', ...')}}`;
          //   str += ` v-bind="${encodeQuotes(spreadsString)}"`;
          // } else {
          spreads.forEach((spread, _spreadIndex) => {
            const withoutPropsPrefix = key.replace('props.', '');
            if (!spread) return;
            if (spread !== withoutPropsPrefix) return;

            if (!blockOptions.spreadCollector) {
              blockOptions.spreadCollector = [];
            }
            blockOptions.spreadCollector.push(spread);

            const spreadIndex = spreads.length === 1 ? '' : _spreadIndex;
            str += ` spreadProps${spreadIndex}.bind="${encodeQuotes(spread)}"`;

            if (DEBUG) {
              str += '--[[Spread]]--';
            }
          });
          // }
        }
        continue;
      }
      if (key.startsWith('$')) {
        continue;
      }

      const { code, rawCode, arguments: cusArgs = ['event'] } = json.bindings[key]!;
      // TODO: proper babel transform to replace. Util for this

      // Event listeners
      if (key.startsWith('on')) {
        let event = key.replace('on', '');
        event = event.charAt(0).toLowerCase() + event.slice(1);

        if (event === 'change' && json.name === 'input' /* todo: other tags */) {
          event = 'input';
        }
        // TODO: proper babel transform to replace. Util for this
        const eventName = cusArgs[0];
        const regexp = new RegExp(
          '(^|\\n|\\r| |;|\\(|\\[|!)' + eventName + '(\\?\\.|\\.|\\(| |;|\\)|$)',
          'g',
        );
        // Step: toggle(event)
        const replacer = '$1$event$2';
        // Step: toggle($event)
        const replaced = code.replace(regexp, replacer);
        let finalValue = removeSurroundingBlock(replaced);

        // Step: Input Checkbox
        // Step: Input Radio
        // json.bindings; /*?*/
        // json.bindings.checked; /*?*/
        if (isRadioOrCheckbox()) {
          // Step: Event attribute
          const shouldBeCalled = blockOptions.allClassVars?.find(
            (varName) => varName === finalValue,
          );

          if (shouldBeCalled) {
            finalValue += `()`;
          }

          str += ` ${event}.delegate="${indent(finalValue, 2)}"`;

          if (DEBUG) {
            str += '--[[.delegate]]--';
          }
        }
        // if (json.properties)
      } else if (key === 'class') {
        // Step: Class Attribute
        str += ` class="\${${code}}" `;
        if (DEBUG) {
          str += '--[[Class]]--';
        }
      } else if (key === 'ref') {
        // Step: Ref
        str += ` ref=${code} `;
        if (DEBUG) {
          str += '--[[ref]]--';
        }
      } else if (isSlotProperty(key)) {
        const lowercaseKey = pipe(key, stripSlotPrefix, (x) => x.toLowerCase());
        needsToRenderSlots.push(`${code.replace(/(\/\>)|\>/, ` ${lowercaseKey}>`)}`);
      } else if (BINDINGS_MAPPER[key]) {
        str += ` ${BINDINGS_MAPPER[key]}.bind="${indent(code, 2)}"  `;

        if (DEBUG) {
          str += '--[[BINDINGS_MAPPER[key]]]--';
        }
      } else if (isValidHtmlTag || key.includes('-')) {
        // standard html elements need the attr to satisfy the compiler in many cases: eg: svg elements and [fill]
        if (json.bindings.checked) {
          // Step: Input Radio/Checkbox checked
          str += ` ${key}.bind="${rawCode}" `;
        } else {
          // Step: $index
          if (blockOptions.indexNameTracker?.includes(code)) {
            str += ` ${key}.bind="$index" `;
          } else {
            // Step: Attribute binding
            str += ` ${key}.bind="${indent(code, 2)}" `;
            if (DEBUG) {
              str += '--[[Attribute1]]--';
            }
          }
        }
      } else {
        // Step: Attribute binding
        str += ` ${key}.bind="${code}" `;
        if (DEBUG) {
          str += '--[[Attribute2]]--';
        }
      }
    }
    if (selfClosingTags.has(json.name)) {
      return str + ' />';
    }
    str += '>';

    if (needsToRenderSlots.length > 0) {
      str += needsToRenderSlots.map((el) => el).join('');
    }

    if (json.children) {
      // str; /*?*/
      str += json.children
        .map((item) =>
          blockToAurelia(item, options, {
            ...blockOptions,
            callLocation: CallLocation.Children,
          }),
        )
        .join('\n');
    }

    // Step: Closing Tag
    str += `\n</${elSelector}>`;
    // str; /*?*/
  }

  // json.name; /*?*/
  // str; /*?*/
  return str;

  function isRadioOrCheckbox() {
    return (
      json.properties.type !== BuiltInEnums.Radio && json.properties.type !== BuiltInEnums.Checkbox
    );
  }
};

const processAureliaCode =
  ({
    contextVars,
    outputVars,
    domRefs,
    stateVars,
    replaceWith,
  }: {
    contextVars: string[];
    outputVars: string[];
    domRefs: string[];
    stateVars?: string[];
    replaceWith?: string;
  }) =>
  (code: string) =>
    pipe(
      DO_NOT_USE_VARS_TRANSFORMS(code, {
        contextVars,
        domRefs,
        outputVars,
        stateVars,
      }),
      (newCode) => stripStateAndPropsRefs(newCode, { replaceWith }),
    );

export const componentToAurelia: TranspilerGenerator<ToAureliaOptions> =
  (userOptions = DEFAULT_AURELIA_OPTIONS) =>
  ({ component: _component }) => {
    if (new Error().stack?.includes('getErrorString')) return '';

    const DEFAULT_OPTIONS = {
      preserveImports: true,
      preserveFileExtensions: false,
    };

    // Make a copy we can safely mutate, similar to babel's toolchain
    let json = fastClone(_component);
    // _component; /*?*/
    // _component.children[0]; /*?*/
    // /* prettier-ignore */ console.log('Start: componentToAurelia------------------------------------------------------------------------------------------')
    // json; /*?*/
    // /* prettier-ignore */ console.log('End: componentToAurelia------------------------------------------------------------------------------------------')

    const contextVars = Object.keys(json?.context?.get || {});
    const outputVars: string[] = []; // TODO Angular remnant
    const stateVars = Object.keys(json?.state || {});

    const options = mergeOptions({ ...DEFAULT_OPTIONS, ...userOptions });
    options.plugins = [
      ...(options.plugins || []),
      CODE_PROCESSOR_PLUGIN((codeType) => {
        switch (codeType) {
          case 'hooks':
            return flow(
              processAureliaCode({
                replaceWith: 'this',
                contextVars,
                outputVars,
                domRefs: Array.from(getRefs(json)),
                stateVars,
              }),
              (code) => {
                const allMethodNames = Object.entries(json.state)
                  .filter(([_, value]) => value?.type === 'function' || value?.type === 'method')
                  .map(([key]) => key);

                return replaceIdentifiers({
                  code,
                  from: allMethodNames,
                  to: (name) => `this.${name}`,
                });
              },
            );

          case 'bindings':
            return (code) => {
              const newLocal = processAureliaCode({
                contextVars: [],
                outputVars,
                domRefs: [], // the template doesn't need the this keyword.
              })(code);
              const result = newLocal.replace(/"/g, '&quot;');
              return result;
            };
          case 'hooks-deps':
          case 'state':
          case 'properties':
            return (x) => x;
        }
      }),
    ];

    if (options.plugins) {
      json = runPreJsonPlugins(json, options.plugins);
    }

    const [forwardProp, hasPropRef] = getPropsRef(json, true);
    const propsTypeRef = json.propsTypeRef !== 'any' ? json.propsTypeRef : undefined;

    const injectables: string[] = contextVars.map((variableName) => {
      const variableType = json?.context?.get[variableName].name;
      if (options?.experimental?.injectables) {
        return options?.experimental?.injectables(variableName, variableType);
      }
      if (options?.experimental?.inject) {
        return `@Inject(forwardRef(() => ${variableType})) public ${variableName}: ${variableType}`;
      }
      return `public ${variableName} : ${variableType}`;
    });

    const props = getProps(json);
    // prevent jsx props from showing up as @Input
    if (hasPropRef) {
      props.delete(forwardProp);
    }
    props.delete('children');

    // remove props for outputs
    outputVars.forEach((variableName) => {
      props.delete(variableName);
    });

    const outputs = outputVars.map((variableName) => {
      if (options?.experimental?.outputs) {
        return options?.experimental?.outputs(json, variableName);
      }
      return `@Output() ${variableName} = new EventEmitter()`;
    });

    const hasOnMount = Boolean(json.hooks?.onMount);
    const domRefs = getRefs(json);
    const jsRefs = Object.keys(json.refs).filter((ref) => !domRefs.has(ref));

    mapRefs(json, (refName) => {
      const isDomRef = domRefs.has(refName);
      return `this.${isDomRef ? '' : '_'}${refName}`;
    });

    if (options.plugins) {
      // json.children[0].children[0].bindings.checked; /*?*/
      json = runPostJsonPlugins(json, options.plugins);
      // json.children[0].children[0].bindings.checked; /*?*/
    }

    // Step: Import
    const componentsUsed = Array.from(getComponentsUsed(json)).filter((item) => {
      return item.length && isUpperCase(item[0]) && !BUILT_IN_COMPONENTS.has(item);
    });
    const rawAureliaImports = renderPreComponent({
      component: json,
      target: 'aurelia',
      excludeMitosisComponents: !options.preserveImports,
      // excludeMitosisComponents: !options.standalone && !options.preserveImports,
      // preserveFileExtensions: options.preserveFileExtensions,
      componentsUsed,
      importMapper: options?.importMapper,
    });
    // rawAureliaImports; /*?*/
    const aureliaImports = rawAureliaImports.split(MARKER_JSON_ITEM);
    // aureliaImports; /*?*/
    const [jsExports, ...jsOrTemplateImports] = aureliaImports.reverse();
    // jsExports; /*?*/
    // otherMapped; /*?*/
    const importedVars_1 = jsOrTemplateImports.reduce((acc, aureliaImport) => {
      const toParse = aureliaImport.trim();
      if (toParse === '') return acc;

      const importData = JSON.parse(toParse ?? '{}');
      acc.push(importData);
      return acc;
    }, [] as ImportData[]);
    const spreadCollector: string[] = [];
    /**
     * TODO: Could changed assumption made in getCustomImports, because it ignores valuse ,that Aurelia needs, eg
     * `import { Builder } from '@builder.io/sdk';`
     * here, `Builder` will not be assigned to class
     */
    const customImports = getCustomImports(json);
    const { exports: localExports = {} } = json;
    const localExportVars = Object.keys(localExports).filter(
      (key) => localExports[key].usedInLocal,
    );
    const allClassVars = [
      ...contextVars,
      ...outputVars,
      ...Array.from(domRefs),
      ...stateVars,
      ...customImports,
      ...localExportVars,
    ];
    const templateBody = assembleTemplateBody(json, options, spreadCollector, allClassVars);

    const customElementsImports: ImportData[] = [];
    const rawJsImports: ImportData[] = [];
    importedVars_1.forEach((variable) => {
      const nameConvention = kebabCase(variable.name);
      const closingTag = `</${nameConvention}>`; // Assumption: Every custom element used has a closing tag
      const used = templateBody.includes(closingTag); // TODO Find a more precise way to deterimne whether a var was used

      if (used) {
        customElementsImports.push(variable);
        return;
      }

      rawJsImports.push(variable);
    });

    const usedAsClassVars: string[] = [];
    importedVars_1.forEach((variable) => {
      const importedVars = Object.keys(variable.imports);
      const usedInTemplate = importedVars.find((importedVarName) => {
        const included = templateBody.includes(importedVarName); // TODO Find a more precise way to deterimne whether a var was used

        if (included) {
          usedAsClassVars.push(importedVarName);
        }

        return included;
      });
      const usedAsClassVar = customElementsImports.find((customElementsImport) => {
        const usedAsCustomElement = importedVars.find((importedVarName) => {
          const included = customElementsImport.jsPath.includes(importedVarName);
          return included;
        });
        return usedAsCustomElement;
      });
      const used = !!usedInTemplate && !usedAsClassVar;
      return used;
    });
    // usedAsClassVars; /*?*/
    const assignImportedVars = Array.from(
      new Set([...usedAsClassVars, ...customImports, ...localExportVars]),
    ).filter((importedVar) => {
      const isCustomElement = customElementsImports.find((element) => element.name === importedVar);
      const dontAssignWhenCustomElement = !isCustomElement;
      return dontAssignWhenCustomElement;
    });
    // assignImportedVars; /*?*/

    const importKeyword = getTemplateImportName();
    const templateImports = assembleTemplateImports(
      aureliaImports,
      customElementsImports,
      importKeyword,
    );

    let templateContent = '';

    if (templateImports) {
      templateContent += '\n';
      templateContent += templateImports;
      templateContent += '\n';
    }

    templateContent += '\n';
    templateContent += templateBody;

    let finalTemplate = '';

    // Step: Opening template tag V1
    if (isAureliaV1()) {
      finalTemplate += `<${AureliaKeywords.Tempalte}>`;
    }

    if (IS_DEV) {
      finalTemplate += '\n  test\n';
    }

    finalTemplate += indent(templateContent, 2);

    // Step: Closing template tag V1
    if (isAureliaV1()) {
      finalTemplate += `</${AureliaKeywords.Tempalte}>`;
    }

    const indentedTemplate = indent(finalTemplate, 6).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    // const finalTemplate = template;
    // const finalTemplate = indent(template, 6);
    // finalTemplate; /*?*/
    // ${options.standalone ? `import { CommonModule } from '@aurelia/common';` : ''}
    // import { ${outputs.length ? 'Output, EventEmitter, \n' : ''} ${
    //   options?.experimental?.inject ? 'Inject, forwardRef,' : ''
    // } Component ${domRefs.size ? ', ViewChild, ElementRef' : ''}${
    //   props.size ? ', Input' : ''
    // } } from '@aurelia/core';
    const dataString = getStateObjectStringFromComponent(json, {
      format: 'class',
      valueMapper: processAureliaCode({
        replaceWith: 'this',
        contextVars,
        outputVars,
        domRefs: Array.from(domRefs),
        stateVars,
      }),
    });

    const getContextCodeResult = getContextCode(json);

    let getContextCodeResultMethod = '';
    let callGetContextCodeResultMethod = '';
    if (getContextCodeResult) {
      const getContextMethodName = 'getContext';
      const createGetContextCodeResultMethod = () => {
        const result = `
        ${getContextMethodName}() {
          ${getContextCodeResult}
        }
        ${DEBUG ? '// --[[getContentMethod]]--' : ''}
        `;
        return result;
      };
      getContextCodeResultMethod = createGetContextCodeResultMethod();

      callGetContextCodeResultMethod = `
        this.${getContextMethodName}();
        ${DEBUG ? '// --[[callGetContextCodeResultMethod]]--' : ''}
      `;
    }

    const setContextCodeResult = setContextCode({ json, options });

    let setContextCodeResultMethod = '';
    let callSetContextCodeResultMethod = '';
    if (setContextCodeResult) {
      const setContextMethodName = 'setContext';
      const createSetContextCodeResultMethod = () => {
        const result = `
        ${setContextMethodName}() {
          ${setContextCodeResult}
        }
        ${DEBUG ? '// --[[setContentMethod]]--' : ''}

        `;
        return result;
      };
      setContextCodeResultMethod = createSetContextCodeResultMethod();

      callSetContextCodeResultMethod = `
        this.${setContextMethodName}();
        ${DEBUG ? '// --[[callSetContextCodeResultMethod]]--' : ''}
      `;
    }

    const shouldAddAutoinjectImport = !!setContextCodeResult;
    const shouldAddEventAggregatorImport = !!setContextCodeResult;

    const hasConstructor = Boolean(injectables.length || json.hooks?.onInit);
    const shouldAddConstructor = hasConstructor || !!setContextCodeResult;

    const shouldAddAttached =
      hasOnMount || !!callSetContextCodeResultMethod || !!callGetContextCodeResultMethod;

    let str = '';

    if (shouldAddEventAggregatorImport) {
      str += `import {
        EventAggregator
      } from 'aurelia-event-aggregator';`;
      str += '\n';
    }

    // Step: Imports
    str += 'import { ';
    let importFromAureliaFramework = ['inlineView'];
    if (shouldAddAutoinjectImport) {
      importFromAureliaFramework.push('autoinject');
    }
    if (IS_DEV) {
      importFromAureliaFramework.push('customElement');
    }
    if (props.size) {
      importFromAureliaFramework.push('bindable');
    }
    if (json.hooks.onUpdate) {
      importFromAureliaFramework.push('computedFrom');
    }

    importFromAureliaFramework = importFromAureliaFramework.sort((a, b) => {
      return a.charCodeAt(0) - b.charCodeAt(0);
    });

    str += `${importFromAureliaFramework.join(', ')}`;
    str += ' } from "aurelia-framework"';

    str += '\n';
    str += '\n';

    if (rawJsImports.length) {
      const jsImports = rawJsImports.map((raw) => raw.jsPath);
      str += jsImports.join('\n');
      str += '\n';
      str += '\n';
    }
    if (DEBUG) {
      str += '// --[[jsImports]]--';
      str += '\n';
    }

    // jsExports; /*?*/
    if (jsExports.trim().length) {
      str += jsExports;
      if (DEBUG) {
        str += '// --[[jsExports]]--';
      }
      str += '\n';
      str += '\n';
    }

    if (json.types?.length) {
      str += json.types.join('\n');
      if (DEBUG) {
        str += '// --[[json.types]]--';
      }
      str += '\n';
      str += '\n';
    }

    const getPropsDefinition = ({ json }: { json: MitosisComponent }) => {
      if (!json.defaultProps) return '';
      const defalutPropsString = Object.keys(json.defaultProps)
        .map((prop) => {
          const value = json.defaultProps!.hasOwnProperty(prop)
            ? json.defaultProps![prop]?.code
            : '{}';
          return `${prop}: ${value}`;
        })
        .join(',');
      return `const defaultProps = {${defalutPropsString}};\n`;
    };

    // Step: defaultProps
    const defaultProps = getPropsDefinition({ json });
    if (defaultProps) {
      str += getPropsDefinition({ json });
      if (DEBUG) {
        str += '// --[[defautProps]]--';
      }

      str += '\n';
      str += '\n';
    }

    // Step: onUpdate
    /**
     * Aurelia does not have a hook, that updates on change of _any_ property.
     */
    const deps = json.hooks.onUpdate?.reduce((prev, curr) => {
      if (curr.rawDeps) {
        prev.push(...curr.rawDeps);
      }
      return prev;
    }, [] as string[]);
    const withQuotes = deps?.map((dep) => `"${dep}"`);
    const computedFromArgs = withQuotes?.join(', ');

    const onUpdateCode = !json.hooks.onUpdate?.length
      ? ''
      : `@computedFrom(${computedFromArgs})\n  get propertyObserver() {
               ${json.hooks.onUpdate.reduce((code, hook) => {
                 code += hook.code;
                 return code + '\n';
               }, '')}
               return
             }`;

    // Step: inlineView
    str += dedent`
    ${shouldAddAutoinjectImport ? '@autoinject' : ''}
    ${IS_DEV ? '@customElement("my-component")' : ''}
    @inlineView(\`\n  ${indentedTemplate}\n\`)
    `;

    const finalProps = new Set([...Array.from(props), ...spreadCollector]);

    // Step: Class
    str += dedent`
    export class ${json.name} {
      ${Array.from(finalProps)
        .filter((item) => !isSlotProperty(item) && item !== 'children')
        .map((item) => {
          // Step: | never
          const finalPropsTypeRef = propsTypeRef?.includes('| never')
            ? `(${propsTypeRef})`
            : propsTypeRef;
          const propType = propsTypeRef ? `${finalPropsTypeRef}["${item}"]` : 'any';
          // Step: @bindable
          let propDeclaration = `@bindable() ${item}: ${propType}`;
          if (json.defaultProps && json.defaultProps.hasOwnProperty(item)) {
            propDeclaration += ` = defaultProps["${item}"]`;
          }
          return propDeclaration;
        })
        .join('\n')}
      ${DEBUG ? '// --[[@bindable]]--' : ''}

      ${assignImportedVars.map((name) => `${name} = ${name}`).join('\n')}

      ${DEBUG ? '// --[[ViewModelImport]]--' : ''}

      ${outputs.join('\n')}

      ${Array.from(domRefs)
        .map((refName) => `${refName}: HTMLElement`)
        .join('\n')}
      ${DEBUG ? '// --[[vmref]]--' : ''}

      ${dataString}

      ${jsRefs
        .map((ref) => {
          const argument = json.refs[ref].argument;
          const typeParameter = json.refs[ref].typeParameter;
          return `private _${ref}${typeParameter ? `: ${typeParameter}` : ''}${
            argument
              ? ` = ${processAureliaCode({
                  replaceWith: 'this.',
                  contextVars,
                  outputVars,
                  domRefs: Array.from(domRefs),
                  stateVars,
                })(argument)}`
              : ''
          };`;
        })
        .join('\n')}
      ${DEBUG ? '// --[[classAssignment]]--' : ''}

      ${
        shouldAddConstructor
          ? `constructor(
            ${shouldAddEventAggregatorImport ? 'private eventAggregator: EventAggregator,' : ''}
            ${injectables.join(',\n')}
            ) {
            ${
              !json.hooks?.onInit
                ? ''
                : `
              ${json.hooks.onInit?.code}
              `
            }
          }
          `
          : ''
      }

      ${
        shouldAddAttached
          ? `attached() {
              ${
                !json.hooks?.onMount
                  ? ''
                  : `
                ${json.hooks.onMount?.code}
                `
              }

              ${callGetContextCodeResultMethod}
              ${callSetContextCodeResultMethod}
            }`
          : ''
      }

      ${onUpdateCode}

      ${
        !json.hooks.onUnMount
          ? ''
          : `detached() {
              ${json.hooks.onUnMount.code}
            }`
      }

      ${getContextCodeResultMethod}

      ${setContextCodeResultMethod}
    }
  `;

    if (options.plugins) {
      str = runPreCodePlugins(str, options.plugins);
    }
    if (options.prettier !== false) {
      str = tryFormat(str, 'typescript');
    }
    if (options.plugins) {
      str = runPostCodePlugins(str, options.plugins);
    }

    return str;

    function isAureliaV1() {
      const is = options.aureliaVersion === AureliaV1;
      return is;
    }

    function getTemplateImportName() {
      if (isAureliaV1()) {
        return AureliaKeywords.Require;
      }

      return AureliaKeywords.import;
    }
  };

const tryFormat = (str: string, parser: string) => {
  try {
    return format(str, {
      parser,
      plugins: [
        // To support running in browsers
        require('prettier/parser-typescript'),
        require('prettier/parser-postcss'),
        require('prettier/parser-html'),
        require('prettier/parser-babel'),
      ],
      htmlWhitespaceSensitivity: 'ignore',
    });
  } catch (err) {
    console.warn('Could not prettify', { string: str }, err);
  }
  return str;
};

function assembleTemplateImports(
  aureliaImports: string[],
  customElementsImports: ImportData[],
  importKeyword: string,
) {
  // customElementsImports; /*?*/
  const [, ...otherMapped] = aureliaImports;
  const templateImports = customElementsImports.map((imported) => {
    const importString = `<${importKeyword} from="${imported.path}"></${importKeyword}>`;
    return importString;
  });

  let template = '';

  // Step: Template imports
  if (otherMapped) {
    template += templateImports.join('\n');
    if (DEBUG) {
      template += '--[[TemplateImports]]--';
    }
  }

  return template;
}

function assembleTemplateBody(
  json: MitosisComponent,
  options: ToAureliaOptions,
  spreadCollector: string[],
  allClassVars: string[],
): string {
  const childComponents: string[] = [];
  json.imports.forEach(({ imports }) => {
    Object.keys(imports).forEach((key) => {
      if (imports[key] === 'default') {
        childComponents.push(key);
      }
    });
  });
  let css = collectCss(json);
  if (options.prettier !== false) {
    css = tryFormat(css, 'css');
  }

  // template; /*?*/
  let template = '';

  // Step: Import

  // template; /*?*/

  template += json.children
    .map((item) =>
      blockToAurelia(item, options, {
        childComponents,
        callLocation: CallLocation.ChildrenForTemplate,
        spreadCollector,
        allClassVars,
      }),
    )
    .join('\n  ');

  // Step: onUpdate
  if (json.hooks.onUpdate) {
    template += '${propertyObserver}';

    if (DEBUG) {
      template += '--[[onUpdate]]--';
    }
  }

  // Step: Styles
  if (css) {
    template += '\n';
    template += '\n';
    template += '<style>';
    template += css;
    template += '</style>';
    if (DEBUG) {
      template += '--[[Styles]]--';
    }
  }

  // Prettier
  if (options.prettier !== false) {
    template = tryFormat(template, 'html');
  }

  stripMetaProperties(json);

  // Preparing built in component metadata parameters
  const componentMetadata: Record<string, any> = {
    template: indent(template),
    ...(css.length
      ? {
          styles: `[\`${indent(css, 8)}\`]`,
        }
      : {}),
    // ...(options.standalone
    //   ? // TODO: also add child component imports here as well
    //     {
    //       standalone: 'true',
    //       imports: `[${['CommonModule', ...componentsUsed].join(', ')}]`,
    //     }
    //   : {}),
  };
  // Taking into consideration what user has passed in options and allowing them to override the default generated metadata
  Object.entries(json.meta.aureliaConfig || {}).forEach(([key, value]) => {
    componentMetadata[key] = value;
  });

  return template;
}

function getContextCode(json: MitosisComponent) {
  const contextGetters = json.context.get;
  return Object.entries(contextGetters)
    .map(([key, context]): string => {
      const { name } = context;

      return `
      this.eventAggregator.subscribe(${name}.key, (payload) => {
        this.${key} = payload;
      });`;
    })
    .join('\n');
}

function setContextCode({ json, options }: { json: MitosisComponent; options: ToAureliaOptions }) {
  const processCode = stripStateAndProps({ json, options });

  return Object.values(json.context.set)
    .map((context) => {
      const { value, name, ref } = context;
      const key = value ? `${name}.key` : name;

      const valueStr = value
        ? processCode(stringifyContextValue(value))
        : ref
        ? processCode(ref)
        : 'undefined';

      return `this.eventAggregator.publish(${key}, ${valueStr});`;
    })
    .join('\n');
}
