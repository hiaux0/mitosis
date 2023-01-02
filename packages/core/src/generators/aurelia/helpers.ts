import { stripStateAndPropsRefs } from '../../helpers/strip-state-and-props-refs';
import { MitosisComponent } from '../../types/mitosis-component';
import { ToAureliaOptions } from './types';

export const stripStateAndProps =
  ({ options, json }: { options: ToAureliaOptions; json: MitosisComponent }) =>
  (code: string) =>
    stripStateAndPropsRefs(code, {
      replaceWith: (name) => {
        const result = name === 'children' ? '$$slots.default' : `this.${name}`;
        return result;
      },
    });
