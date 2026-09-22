import assert from 'node:assert/strict';
import { test } from 'node:test';
import { speakNumber } from './speech-numbers.ts';

test('English integers preserve ordinary wording across units, tens, and large groups', () => {
  const examples = [
    ['0', 'zero'],
    ['11', 'eleven'],
    ['15', 'fifteen'],
    ['21', 'twenty-one'],
    ['25', 'twenty-five'],
    ['101', 'one hundred one'],
    ['105', 'one hundred five'],
    ['1005', 'one thousand five'],
    ['1000005', 'one million five'],
    ['1250000', 'one million two hundred fifty thousand'],
    [
      '999999999999',
      'nine hundred ninety-nine billion nine hundred ninety-nine million nine hundred ninety-nine thousand nine hundred ninety-nine',
    ],
  ] as const;
  for (const [integer, expected] of examples) {
    assert.equal(speakNumber(integer, undefined, 'en'), expected, integer);
  }
});

test('Vietnamese integers use contextual one/five and padded lower three-digit groups', () => {
  const examples = [
    ['0', 'không'],
    ['11', 'mười một'],
    ['15', 'mười lăm'],
    ['21', 'hai mươi mốt'],
    ['24', 'hai mươi bốn'],
    ['25', 'hai mươi lăm'],
    ['101', 'một trăm lẻ một'],
    ['105', 'một trăm lẻ năm'],
    ['1005', 'một nghìn không trăm lẻ năm'],
    ['1025', 'một nghìn không trăm hai mươi lăm'],
    ['1000005', 'một triệu không trăm lẻ năm'],
    ['1005000', 'một triệu không trăm lẻ năm nghìn'],
    ['1250000', 'một triệu hai trăm năm mươi nghìn'],
    [
      '999999999999',
      'chín trăm chín mươi chín tỷ chín trăm chín mươi chín triệu chín trăm chín mươi chín nghìn chín trăm chín mươi chín',
    ],
  ] as const;
  for (const [integer, expected] of examples) {
    assert.equal(speakNumber(integer, undefined, 'vi'), expected, integer);
  }
});

test('decimal fractions retain every digit including leading and trailing zeroes', () => {
  assert.equal(speakNumber('55', '50', 'en'), 'fifty-five point five zero');
  assert.equal(speakNumber('55', '50', 'vi'), 'năm mươi lăm phẩy năm không');
  assert.equal(speakNumber('0', '05', 'en'), 'zero point zero five');
  assert.equal(speakNumber('0', '05', 'vi'), 'không phẩy không năm');
  assert.equal(speakNumber('1', '0', 'en'), 'one point zero');
  assert.equal(speakNumber('1', '00', 'vi'), 'một phẩy không không');
});

test('ambiguous, signed, formatted, oversized, and invalid numbers are rejected', () => {
  for (const integer of [
    '',
    '00',
    '05',
    '1,000',
    '1.000',
    '-55',
    '+55',
    ' 55',
    '55 ',
    '55\n',
    '1e3',
    'NaN',
    '1000000000000',
  ]) {
    for (const language of ['en', 'vi'] as const) {
      assert.equal(speakNumber(integer, undefined, language), null, integer);
    }
  }
  for (const fraction of ['', '000', '-1', '+1', '.5', '5 ', '5\n', 'a']) {
    assert.equal(speakNumber('55', fraction, 'en'), null, fraction);
    assert.equal(speakNumber('55', fraction, 'vi'), null, fraction);
  }
});
