const Factory = require('rosie').Factory;
const Faker = require('@faker-js/faker');

const CONDOMS = 'condoms';
const BIRTH_CONTROL = ['iud', 'btl', 'emergency_pill', 'norplant', 'depoprovera', 'progesterone', 'dmpa', 'cop'];
const NONE = 'fp_none';

/**
 * Generates birth control method.
 * None cannot be selected along with the other options.
 * Condoms are the only family planing method that can be combined with another family planning method.
 */
const generateFpMethods = () => {
  const methods = [];
  methods.push(Faker.faker.random.arrayElement([...BIRTH_CONTROL, CONDOMS, NONE]));
  if (methods[0] === CONDOMS) {
    methods.push(Faker.faker.helpers.uniqueArray(
      BIRTH_CONTROL,
      Faker.faker.datatype.number({ min: 0, max: 1 })).toString());
  }
  return methods.join(' ');
}
/**
 * BRAC International is a leading nonprofit organisation with a mission to empower people and
 * communities in situations of poverty, illiteracy, disease, and social injustice
 * brac-fp-flow Factory generates Javascript object that represent Family Planing Workflow
 * for the brac configuration.
 */
module.exports = new Factory()
  .attr('fp', Faker.faker.datatype.boolean())
  .attr('fp_method', ['fp'], (fp) => {
    if (fp) {
      return generateFpMethods();
    }
  })
  .attr('fp_enroll', ['fp', 'fp_method'], (fp, fpMethod) => {
    if (!fp || fpMethod === NONE) {
      return Faker.faker.datatype.boolean();
    }
  })
  .attr('fp_method_choice', ['fp_enroll'], (fp_enroll) => {
    if (fp_enroll) {
      return generateFpMethods();
    }
  });
