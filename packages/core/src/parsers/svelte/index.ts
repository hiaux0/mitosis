import { parse, preprocess } from 'svelte/compiler';
import preprocessor from 'svelte-preprocess';
import { omit } from 'lodash';

import { parseModule } from './module';
import { parseInstance } from './instance';
import { parseCss } from './css';
import { parseHtml } from './html';
import { postProcess } from './helpers/post-process';
import { collectTypes, isTypeScriptComponent } from './typescript';

import type { Ast } from 'svelte/types/compiler/interfaces';
import type { MitosisComponent } from '../../types/mitosis-component';
import type { SveltosisComponent } from './types';

function mapAstToMitosisJson(
  ast: Ast,
  name: string,
  string_ = '',
  usesTypescript = false,
): MitosisComponent {
  const json: SveltosisComponent = {
    '@type': '@builder.io/mitosis/component',
    inputs: [],
    state: {},
    props: {},
    refs: {},
    hooks: {},
    imports: [],
    children: [],
    context: { get: {}, set: {} },
    subComponents: [],
    meta: {},
    name,
    style: undefined,
  };

  parseModule(ast, json);
  parseInstance(ast, json);
  parseHtml(ast, json);
  // json; /*?*/
  parseCss(ast, json);

  postProcess(json);
  // json; /*?*/

  if (usesTypescript) {
    collectTypes(string_, json);
  }

  return omit(json, ['props']);
}

export const parseSvelte = async function (
  string_: string,
  path = 'MyComponent.svelte',
): Promise<MitosisComponent> {
  const usesTypescript = isTypeScriptComponent(string_);

  const processedString = await preprocess(
    string_,
    [
      preprocessor({
        typescript: usesTypescript ? { tsconfigFile: false } : false,
      }),
    ],
    {
      filename: path.split('/').pop(),
    },
  );

  const ast = parse(processedString.code);
  // ast.html.children[1].children[3].attributes[1]; /*?*/
  const componentName = path.split('/').pop()?.split('.')[0] ?? 'MyComponent';
  return mapAstToMitosisJson(ast, componentName, string_, usesTypescript);
};
