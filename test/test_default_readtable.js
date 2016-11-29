import test from 'ava';
import expect from 'expect.js';
import { List } from 'immutable';

import CharStream from '../src/char-stream';
import '../src/default-readtable';
import read from '../src/reader/token-reader';
import { TokenType as TT, TokenClass as TC, EmptyToken } from '../src/tokens';
import { LSYNTAX, RSYNTAX } from '../src/reader/utils';

function testParse(source, tst) {
  const results = read(source);

  if (results.isEmpty()) return;

  tst(results.first().token);
}

function testParseResults(source, tst) {
  tst(read(source).map(s => s.token));
}

test('should parse Unicode identifiers', t => {
  function testParseIdentifier(source, id) {
    testParse(source, result => {
      t.is(result.value, id);
      t.is(result.type, TT.IDENTIFIER);
      t.deepEqual(result.slice.startLocation, {
        filename: '',
        line: 1,
        column: 1,
        position: 0
      });
    });
  }

  testParseIdentifier('abcd xyz', 'abcd');
  testParseIdentifier('awaits ', 'awaits');
  testParseIdentifier('日本語 ', '日本語');
  testParseIdentifier('\u2163\u2161 ', '\u2163\u2161');
  testParseIdentifier('\\u2163\\u2161 ', '\u2163\u2161');
  testParseIdentifier('\u{102A7} ', '\u{102A7}');
  testParseIdentifier('\\u{102A7} ', '\u{102A7}');
  testParseIdentifier('\uD800\uDC00 ', '\uD800\uDC00');
  testParseIdentifier('\u2163\u2161\u200A', '\u2163\u2161');
});

test('should parse keywords', t => {
  function testParseKeyword(source, id) {
    testParse(source, result => {
      t.is(result.value, id);
      t.is(result.type.klass, TC.Keyword);
      t.deepEqual(result.slice.startLocation, {
        filename: '',
        line: 1,
        column: 1,
        position: 0
      });
    });
  }

  testParseKeyword('await ', 'await');
  testParseKeyword('break ', 'break');
  testParseKeyword('case ', 'case');
  testParseKeyword('catch ', 'catch');
  testParseKeyword('class ', 'class');
});

test('should parse punctuators', t => {
  function testParsePunctuator(source, p) {
    testParse(source, result => {
      t.is(result.value, p);
      t.is(result.type.klass, TC.Punctuator);
      t.deepEqual(result.slice.startLocation, {
        filename: '',
        line: 1,
        column: 1,
        position: 0
      });
    });
  }

  testParsePunctuator('+ ', '+');
  testParsePunctuator('+= ', '+=');
  testParsePunctuator('; ', ';');
  testParsePunctuator('>>> ', '>>>');
  testParsePunctuator('+42', '+');
});

test('should parse whitespace', t => {
  function testParseWhiteSpace(source) {
    testParse(source, result => t.is(result, EmptyToken));
  }
  testParseWhiteSpace(' ');
  testParseWhiteSpace('\t');
  testParseWhiteSpace('\uFEFF');
});

test('should parse line terminators', t => {
  function testParseLineTerminators(source) {
    testParse(source, result => {
      t.is(result, EmptyToken);
    });
  }

  testParseLineTerminators('\n');
  testParseLineTerminators('\r\n');
  testParseLineTerminators('\u2029');
});

test('should parse numeric literals', t => {
  function testParseNumericLiterals(source, value) {
    testParse(source, result => t.is(result.value, value));
  }
  testParseNumericLiterals('0xFFFF ', 0xFFFF);
  testParseNumericLiterals('0xFF ', 0xFF);
  testParseNumericLiterals('0o0756 ', 0o0756);
  testParseNumericLiterals('0o76 ', 0o76);
  testParseNumericLiterals('0b1010 ', 0b1010);
  testParseNumericLiterals('0b10 ', 0b10);
  testParseNumericLiterals('042 ', 0o042);
  testParseNumericLiterals('42 ', 42);
});

test('should parse string literals', t => {
  function testParseStringLiteral(source, value) {
    testParse(source, result => {
      expect(result.type).to.eql(TT.STRING);
      expect(result.str).to.eql(value);
    });
  }

  testParseStringLiteral('""', '');
  testParseStringLiteral("'x'", 'x');
  testParseStringLiteral('"x"', 'x');
  testParseStringLiteral("'\\\\\\''", "\\'");
  testParseStringLiteral('"\\\\\\\""', '\\\"');
  testParseStringLiteral("'\\\r'", '\r');
  testParseStringLiteral('"\\\r\n"', '\r\n');
  testParseStringLiteral('"\\\n"', '\n');
  testParseStringLiteral('"\\\u2028"', '\u2028');
  testParseStringLiteral('"\\\u2029"', '\u2029');
  testParseStringLiteral('"\\u202a"', '\u202a');
  testParseStringLiteral('"\\0"', '\0');
  testParseStringLiteral('"\\0x"', '\0x');
  testParseStringLiteral('"\\01"', '\x01');
  testParseStringLiteral('"\\1"', '\x01');
  testParseStringLiteral('"\\11"', '\t');
  testParseStringLiteral('"\\111"', 'I');
  testParseStringLiteral('"\\1111"', 'I1');
  testParseStringLiteral('"\\2111"', '\x891');
  testParseStringLiteral('"\\5111"', ')11');
  testParseStringLiteral('"\\5a"', '\x05a');
  testParseStringLiteral('"\\7a"', '\x07a');
  testParseStringLiteral('"\a"', 'a');
  testParseStringLiteral('"\\u{00F8}"', '\xF8');
  testParseStringLiteral('"\\u{0}"', '\0');
  testParseStringLiteral('"\\u{10FFFF}"', '\uDBFF\uDFFF');
  testParseStringLiteral('"\\u{0000000000F8}"', '\xF8');
});

test('should parse template literals', t => {
  function testParseTemplateLiteral(source, value, isTail, isInterp) {
    testParse(source, result => {
      t.is(result.type, TT.TEMPLATE);
      const elt = result.items.first();
      t.is(elt.type, TT.TEMPLATE);
      t.is(elt.value, value);
      t.is(elt.tail, isTail);
      t.is(elt.interp, isInterp);
    });
  }

  testParseTemplateLiteral('`foo`', 'foo', true, false);
  testParseTemplateLiteral('`"foo"`', '"foo"', true, false);
  testParseTemplateLiteral('`\\111`', 'I', true, false);
  testParseTemplateLiteral('`foo${bar}`', 'foo', false, true);
  testParse('`foo${bar}baz`', result => {
    t.is(result.type, TT.TEMPLATE);
    const [x,y,z] = result.items;

    t.is(x.type, TT.TEMPLATE);
    t.is(x.value, 'foo');
    t.false(x.tail);
    t.true(x.interp);

    t.true(List.isList(y.token));
    t.is(y.token.get(1).token.type, TT.IDENTIFIER);
    t.is(y.token.get(1).token.value, 'bar');

    t.is(z.type, TT.TEMPLATE);
    t.is(z.value, 'baz');
    t.true(z.tail);
    t.false(z.interp);
  });
});

test('should parse delimiters', t => {
  function testParseDelimiter(source, value) {
    testParse(source, results => {
      t.true(List.isList(results));
      results.forEach((r, i) => t.true(source.includes(r.token.value)));
    });
  }

  testParseDelimiter('{a}', 'a');

  testParse('{ x + z }', result => {
    t.true(List.isList(result));

    const [v,w,x,y,z] = result.map(s => s.token);

    t.is(v.type, TT.LBRACE);

    t.is(w.type, TT.IDENTIFIER);
    t.is(w.value, 'x');

    t.is(x.type, TT.ADD);

    t.is(y.type, TT.IDENTIFIER);
    t.is(y.value, 'z');

    t.is(z.type, TT.RBRACE);
  });

  testParse('[ x , z ]', result => {
    t.true(List.isList(result));

    const [v,w,x,y,z] = result.map(s => s.token);

    t.is(v.type, TT.LBRACK);

    t.is(w.type, TT.IDENTIFIER);
    t.is(w.value, 'x');

    t.is(x.type, TT.COMMA);

    t.is(y.type, TT.IDENTIFIER);
    t.is(y.value, 'z');

    t.is(z.type, TT.RBRACK);
  });

  testParse('[{x : 3}, z]', result => {
    t.true(List.isList(result));

    const [v,w,x,y,z] = result.map(s => s.token);

    t.is(v.type, TT.LBRACK);

    t.true(List.isList(w));

    const [a,b,c,d,e] = w.map(s => s.token);

    t.is(a.type, TT.LBRACE);

    t.is(b.type, TT.IDENTIFIER);
    t.is(b.value, 'x');

    t.is(c.type, TT.COLON);

    t.is(d.type, TT.NUMBER);
    t.is(d.value, 3);

    t.is(e.type, TT.RBRACE);

    t.is(x.type, TT.COMMA);

    t.is(y.type, TT.IDENTIFIER);
    t.is(y.value, 'z');

    t.is(z.type, TT.RBRACK);
  });

  testParseResults(`foo('bar')`, ([foo, bar])=> {
    t.is(foo.type, TT.IDENTIFIER);
    t.is(foo.value, 'foo');

    const [x,y,z] = bar.map(s => s.token);


    t.is(x.type, TT.LPAREN);

    t.is(y.type, TT.STRING);
    t.is(y.str, 'bar');
    t.is(y.slice.text, "'bar'");

    t.is(z.type, TT.RPAREN);
  });
});

test('should parse regexp literals', t => {
  function testParseRegExpLiteral(source, value) {
    testParse(source, result => {
      t.is(result.type, TT.REGEXP);
      t.is(result.value, value);
    });
  }

  testParseRegExpLiteral('/foo/g ', '/foo/g');
  testParseRegExpLiteral('/=foo/g ', '/=foo/g');

  testParseResults('if (x) /a/', ([x,y,z]) => {
    t.is(x.type, TT.IF);
    t.true(List.isList(y));

    t.is(z.type, TT.REGEXP);
    t.is(z.value, '/a/');
  });
});

test('should parse division expressions', t => {
  testParseResults('a/4/3', ([v,w,x,y,z]) => {
    t.is(v.type, TT.IDENTIFIER);
    t.is(v.value, 'a');

    t.is(w.type, TT.DIV);

    t.is(x.type, TT.NUMBER);
    t.is(x.value, 4);

    t.is(y.type, TT.DIV);

    t.is(z.type, TT.NUMBER);
    t.is(z.value, 3);
  });
});

test('should parse syntax templates', t => {
  testParseResults('#`a 1 ${}`', ([result]) => {
    const [u,v,w,x,y,z] = result.map(s => s.token);
    t.is(u.type, LSYNTAX);

    t.is(v.type, TT.IDENTIFIER);
    t.is(v.value, 'a');

    t.is(w.type, TT.NUMBER);
    t.is(w.value, 1);

    t.is(x.type, TT.IDENTIFIER);
    t.is(x.value, '$');

    t.true(List.isList(y));
    t.is(y.first().token.type, TT.LBRACE);
    t.is(y.get(1).token.type, TT.RBRACE);

    t.is(z.type, RSYNTAX);
  });
});

test('should parse comments', t => {
  function testParseComment(source) {
    const result = read(source);
    t.true(result.isEmpty());
  };

  testParseComment('// this is a single line comment\n // here\'s another');
  testParseComment('/* this is a block line comment */');
  testParseComment(
`/*
  * this
  * is
  * a
  * multi
  * line
  * comment
  */`);
  });