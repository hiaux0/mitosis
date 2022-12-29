import { DEFAULT_AURELIA_OPTIONS } from '../generators/aurelia/constants';
import { componentToAurelia } from '../generators/aurelia';
import { runTestsForTarget } from './shared';

describe('Aurelia', () => {
  runTestsForTarget({
    options: DEFAULT_AURELIA_OPTIONS,
    target: 'aurelia',
    generator: componentToAurelia,
  });
  // runTestsForTarget({
  //   options: {
  //     standalone: true,
  //   },
  //   target: 'aurelia',
  //   generator: componentToAurelia,
  // });
});
