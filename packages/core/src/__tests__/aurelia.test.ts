import { componentToAurelia } from '../generators/aurelia';
import { runTestsForTarget } from './shared';

describe('Aurelia', () => {
  runTestsForTarget({ options: {}, target: 'aurelia', generator: componentToAurelia });
  runTestsForTarget({
    options: {
      standalone: true,
    },
    target: 'aurelia',
    generator: componentToAurelia,
  });
});
