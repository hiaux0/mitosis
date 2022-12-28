module.exports = function (wallaby) {
  return {
    autoDetect: true,
    files: [
      // {
      //   pattern: 'src/**/*.+(ts|html|json)',
      //   load: false,
      // },
      'src/**/*.ts',
      { pattern: '**/*.spec.ts', ignore: true },
      // 'test/**/*.feature',
      // 'test/common-test/**/*.ts',
      // 'test/unit-cucumber/init-cucumber-testing.spec.ts',
      // 'test/unit-cucumber/step-definitions/**/*.ts',
    ],

    tests: [
      // 'test/test-launchers/init-tests.spec.ts',
      // 'test/unit-cucumber/step-definitions/letter-e.spec.ts',
      // 'test/unit-cucumber/step-definitions/vim-input.spec.ts',
      '**/*.spec.ts',
    ],

    // testFramework: 'vitest',
    // env: {
    //   type: 'node',
    // },
    debug: true,
  };
};
