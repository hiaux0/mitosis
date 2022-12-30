import dedent from 'dedent';
import { format } from 'prettier/standalone';
import { collectCss } from '../../helpers/styles/collect-css';
import { fastClone } from '../../helpers/fast-clone';
import { getRefs } from '../../helpers/get-refs';
import { getStateObjectStringFromComponent } from '../../helpers/get-state-object-string';
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
import { getPropFunctions } from '../../helpers/get-prop-functions';
import { isString, kebabCase, uniq } from 'lodash';
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
import { AureliaV1, ToAureliaOptions } from './types';
import { DEFAULT_AURELIA_OPTIONS } from './constants';

const BUILT_IN_COMPONENTS = new Set(['Show', 'For', 'Fragment', 'Slot']);

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
  callLocation: CallLocation;
}

const mappers: {
  [key: string]: (json: MitosisNode, options: ToAureliaOptions) => string;
} = {
  Fragment: (json, options) => {
    options;
    return `<${AureliaKeywords.Tempalte}>${json.children
      .map((item) => blockToAurelia(item, options, { callLocation: CallLocation.Fragment }))
      .join('\n')}</${AureliaKeywords.Tempalte}>`;
  },
  Slot: (json, options) => {
    const renderChildren = () =>
      json.children
        ?.map((item) => blockToAurelia(item, options, { callLocation: CallLocation.Slot }))
        .join('\n');
    const renderedChildren = renderChildren();

    return `\n<slot ${Object.entries({ ...json.bindings, ...json.properties })
      .map(([binding, value]) => {
        if (value && binding === 'name') {
          const selector = pipe(isString(value) ? value : value.code, stripSlotPrefix, kebabCase);
          return `select="[${selector}]"`;
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
  blockOptions: AureliaBlockOptions = { callLocation: CallLocation.Start },
): string => {
  // blockOptions.callLocation; /*?*/
  // json.name; /*?*/
  const childComponents = blockOptions?.childComponents || [];
  const isValidHtmlTag = VALID_HTML_TAGS.includes(json.name.trim());

  if (mappers[json.name]) {
    return mappers[json.name](json, options);
  }

  if (isChildren({ node: json })) {
    return `<ng-content></ng-content>`;
  }

  if (json.properties._text) {
    return json.properties._text;
  }
  const textCode = json.bindings._text?.code;
  if (textCode) {
    if (isSlotProperty(textCode)) {
      const selector = pipe(textCode, stripSlotPrefix, kebabCase);
      return `<ng-content select="[${selector}]"></ng-content>`;
    }

    return `\${${textCode}}`;
  }

  let str = '';

  const needsToRenderSlots = [];

  if (checkIsForNode(json)) {
    // Step: For / Step: Repeat for
    const indexName = json.scope.indexName;
    str += `<template repeat.for="${json.scope.forName} of ${json.bindings.each?.code}${
      indexName ? `; let ${indexName} = index` : ''
    }">`;
    str += json.children
      .map((item) =>
        blockToAurelia(item, options, { ...blockOptions, callLocation: CallLocation.For }),
      )
      .join('\n');
    str += `</template>`;
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
    const elSelector = childComponents.find((impName) => impName === json.name)
      ? kebabCase(json.name)
      : json.name;

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
        const finalValue = removeSurroundingBlock(replaced);

        // Step: Input Checkbox
        // Step: Input Radio
        // json.bindings; /*?*/
        // json.bindings.checked; /*?*/
        if (isRadioOrCheckbox()) {
          // Step: Event attribute
          str += ` ${event}.delegate="${finalValue}" `;
        }
        // if (json.properties)
      } else if (key === 'class') {
        // Step: Class Attribute
        str += ` class="${code}" `;
      } else if (key === 'ref') {
        str += ` #${code} `;
      } else if (isSlotProperty(key)) {
        const lowercaseKey = pipe(key, stripSlotPrefix, (x) => x.toLowerCase());
        needsToRenderSlots.push(`${code.replace(/(\/\>)|\>/, ` ${lowercaseKey}>`)}`);
      } else if (BINDINGS_MAPPER[key]) {
        str += ` ${BINDINGS_MAPPER[key]}.bind="${code}"  `;
      } else if (isValidHtmlTag || key.includes('-')) {
        // standard html elements need the attr to satisfy the compiler in many cases: eg: svg elements and [fill]
        if (json.bindings.checked) {
          // Step: Input Radio/Checkbox checked
          str += ` ${key}.bind="${rawCode}" `;
        } else {
          // Step: Attribute binding
          str += ` ${key}.bind="${code}" `;
        }
      } else {
        // Step: Attribute binding
        str += `${key}.bind="${code}" `;
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
          blockToAurelia(item, options, { ...blockOptions, callLocation: CallLocation.Children }),
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
    const metaOutputVars: string[] = (json.meta?.useMetadata?.outputs as string[]) || [];
    const outputVars = uniq([...metaOutputVars, ...getPropFunctions(json)]);
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
              return newLocal.replace(/"/g, '&quot;');
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
    const childComponents: string[] = [];
    const propsTypeRef = json.propsTypeRef !== 'any' ? json.propsTypeRef : undefined;

    json.imports.forEach(({ imports }) => {
      Object.keys(imports).forEach((key) => {
        if (imports[key] === 'default') {
          childComponents.push(key);
        }
      });
    });

    const customImports = getCustomImports(json);

    const { exports: localExports = {} } = json;
    const localExportVars = Object.keys(localExports)
      .filter((key) => localExports[key].usedInLocal)
      .map((key) => `${key} = ${key};`);

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
    const hasConstructor = Boolean(injectables.length || json.hooks?.onInit);

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
    const componentsUsed = Array.from(getComponentsUsed(json)).filter((item) => {
      return item.length && isUpperCase(item[0]) && !BUILT_IN_COMPONENTS.has(item);
    });

    mapRefs(json, (refName) => {
      const isDomRef = domRefs.has(refName);
      return `this.${isDomRef ? '' : '_'}${refName}${isDomRef ? '.nativeElement' : ''}`;
    });

    if (options.plugins) {
      // json.children[0].children[0].bindings.checked; /*?*/
      json = runPostJsonPlugins(json, options.plugins);
      // json.children[0].children[0].bindings.checked; /*?*/
    }
    let css = collectCss(json);
    if (options.prettier !== false) {
      css = tryFormat(css, 'css');
    }

    // template; /*?*/
    const aureliaImports = renderPreComponent({
      component: json,
      target: 'aurelia',
      excludeMitosisComponents: !options.preserveImports,
      // excludeMitosisComponents: !options.standalone && !options.preserveImports,
      // preserveFileExtensions: options.preserveFileExtensions,
      componentsUsed,
      importMapper: options?.importMapper,
    });

    let template = '';

    // Step: Opening template tag V1
    if (isAureliaV1()) {
      template += `<${AureliaKeywords.Tempalte}>`;
    }

    template += aureliaImports;

    template += json.children
      .map((item) =>
        blockToAurelia(item, options, {
          childComponents,
          callLocation: CallLocation.ChildrenForTemplate,
        }),
      )
      .join('\n  ');

    // Step: Closing template tag V1
    if (isAureliaV1()) {
      template += `</${AureliaKeywords.Tempalte}>`;
    }

    // Prettier
    if (options.prettier !== false) {
      template = tryFormat(template, 'html');
    }

    stripMetaProperties(json);

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

    const finalTemplate = indent(template, 6).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    // const finalTemplate = template;
    // const finalTemplate = indent(template, 6);
    // finalTemplate; /*?*/
    // ${options.standalone ? `import { CommonModule } from '@aurelia/common';` : ''}
    // import { ${outputs.length ? 'Output, EventEmitter, \n' : ''} ${
    //   options?.experimental?.inject ? 'Inject, forwardRef,' : ''
    // } Component ${domRefs.size ? ', ViewChild, ElementRef' : ''}${
    //   props.size ? ', Input' : ''
    // } } from '@aurelia/core';
    let str = '';

    // Steps: Imports
    str += 'import { ';
    let importFromAureliaFramework = ['inlineView'];
    if (props.size) {
      importFromAureliaFramework.push('bindable');
    }
    importFromAureliaFramework = importFromAureliaFramework.sort((a, b) => {
      return a.charCodeAt(0) - b.charCodeAt(0);
    });

    str += `${importFromAureliaFramework.join(', ')}`;
    str += ' } from "aurelia-framework"';

    str += '\n';
    str += '\n';

    // Steps: inlineView
    str += dedent`
    @inlineView(\`\n  ${finalTemplate}\`)
    `;

    // Steps: Class
    str += dedent`
    export class ${json.name} {
      ${localExportVars.join('\n')}
      ${customImports.map((name) => `${name} = ${name}`).join('\n')}

      ${Array.from(props)
        .filter((item) => !isSlotProperty(item) && item !== 'children')
        .map((item) => {
          const propType = propsTypeRef ? `${propsTypeRef}["${item}"]` : 'any';
          // Step: @bindable
          let propDeclaration = `@bindable() ${item}: ${propType}`;
          if (json.defaultProps && json.defaultProps.hasOwnProperty(item)) {
            propDeclaration += ` = defaultProps["${item}"]`;
          }
          return propDeclaration;
        })
        .join('\n')}

      ${outputs.join('\n')}

      ${Array.from(domRefs)
        .map((refName) => `@ViewChild('${refName}') ${refName}: ElementRef`)
        .join('\n')}

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

      ${
        !hasConstructor
          ? ''
          : `constructor(\n${injectables.join(',\n')}) {
            ${
              !json.hooks?.onInit
                ? ''
                : `
              ${json.hooks.onInit?.code}
              `
            }
          }
          `
      }
      ${
        !hasOnMount
          ? ''
          : `attached() {

              ${
                !json.hooks?.onMount
                  ? ''
                  : `
                ${json.hooks.onMount?.code}
                `
              }
            }`
      }

      ${
        !json.hooks.onUpdate?.length
          ? ''
          : `propertyChanged(newValue, oldValue) {
              ${json.hooks.onUpdate.reduce((code, hook) => {
                code += hook.code;
                return code + '\n';
              }, '')}
            }`
      }

      ${
        !json.hooks.onUnMount
          ? ''
          : `detached() {
              ${json.hooks.onUnMount.code}
            }`
      }

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
      return options.aureliaVersion === AureliaV1;
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
