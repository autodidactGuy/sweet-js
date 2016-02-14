import { List } from 'immutable';
import { enforestExpr, Enforester } from "./enforester";
import TermExpander from "./term-expander.js";
import BindingMap from "./binding-map.js";
import Env from "./env";
import resolve from 'resolve';
import Reader from "./shift-reader";
import * as _ from "ramda";
import Term, {
  isEOF, isBindingIdentifier, isFunctionDeclaration, isFunctionExpression,
  isFunctionTerm, isFunctionWithName, isSyntaxDeclaration, isSyntaxrecDeclaration, isVariableDeclaration,
  isVariableDeclarationStatement, isImport, isExport
} from "./terms";
import { Maybe } from 'ramda-fantasy';
import { gensym } from './symbol';
import { VarBindingTransform, CompiletimeTransform } from './transforms';
import { expect, assert } from "./errors";
import loadSyntax from './load-syntax';
import { Scope, freshScope } from "./scope";

const Just = Maybe.Just;
const Nothing = Maybe.Nothing;

let registerBindings = _.cond([
  [isBindingIdentifier, ({name}, context) => {
    let newBinding = gensym(name.val());
    context.env.set(newBinding.toString(), new VarBindingTransform(name));
    context.bindings.add(name, {
      binding: newBinding,
      phase: 0,
      // skip dup because js allows variable redeclarations
      // (technically only for `var` but we can let later stages of the pipeline
      // handle incorrect redeclarations of `const` and `let`)
      skipDup: true
    });
  }],
  [_.T, _ => assert(false, "not implemented yet")]
]);

let removeScope = _.cond([
  [isBindingIdentifier, ({name}, scope) => new Term('BindingIdentifier', {
    name: name.removeScope(scope)
  })],
  [_.T, _ => assert(false, "not implemented yet")]
]);

function findNameInExports(name, exp) {
  let foundNames = exp.reduce((acc, e) => {
    if (e.declaration) {
      return acc.concat(e.declaration.declaration.declarators.reduce((acc, decl) => {
        if (decl.binding.name.val() === name.val()) {
          return acc.concat(decl.binding.name);
        }
        return acc;
      }, List()));
    }
    return acc;
  }, List());
  assert(foundNames.size <= 1, 'expecting no more than 1 matching name in exports');
  return foundNames.get(0);
}


function bindImports(impTerm, exModule, context) {
  let names = [];
  impTerm.namedImports.forEach(specifier => {
    let name = specifier.binding.name;
    let exportName = findNameInExports(name, exModule.exportEntries);
    if (exportName != null) {
      let newBinding = gensym(name.val());
      context.bindings.addForward(name, exportName, newBinding);
      if (context.store.has(exportName.resolve())) {
        names.push(name);
      }
    }
    // // TODO: better error
    // throw 'imported binding ' + name.val() + ' not found in exports of module' + exModule.moduleSpecifier;
  });
  return List(names);
}


export default class TokenExpander {
  constructor(context) {
    this.context = context;
  }

  expand(stxl) {
    let result = List();
    if (stxl.size === 0) {
      return result;
    }
    let prev = List();
    let enf = new Enforester(stxl, prev, this.context);
    let self = this;
    while (!enf.done) {

      let term = _.pipe(
        _.bind(enf.enforest, enf),
        _.cond([
          [isVariableDeclarationStatement, term => {
            // first, remove the use scope from each binding
            term.declaration.declarators = term.declaration.declarators.map(decl => {
              return new Term('VariableDeclarator', {
                binding: removeScope(decl.binding, self.context.useScope),
                init: decl.init
              });
            });

            // syntax id^{a, b} = <init>^{a, b}
            // ->
            // syntaxrec id^{a,b,c} = function() { return <<id^{a}>> }
            // syntaxrec id^{a,b} = <init>^{a,b,c}
            if (isSyntaxDeclaration(term.declaration)) {
              // TODO: do stuff
              let scope = freshScope('nonrec');
              term.declaration.declarators.forEach(decl => {
                let name = decl.binding.name;
                let nameAdded = name.addScope(scope);
                let nameRemoved = name.removeScope(self.context.currentScope[self.context.currentScope.length - 1]);
                let newBinding = gensym(name.val());
                self.context.bindings.addForward(nameAdded, nameRemoved, newBinding);
                decl.init.body = decl.init.body.map(s => s.addScope(scope, self.context.bindings));
              });
            }

            // for syntax declarations we need to load the compiletime value
            // into the environment
            if (isSyntaxDeclaration(term.declaration) || isSyntaxrecDeclaration(term.declaration)) {
              term.declaration.declarators.forEach(decl => {
                registerBindings(decl.binding, self.context);
                loadSyntax(decl, self.context, self.context.env);
              });
              // do not add syntax declarations to the result
              return Nothing();
            } else {
              // add each binding to the environment
              term.declaration.declarators.forEach(decl =>
                registerBindings(decl.binding, self.context)
              );
            }
            return Just(term);
          }],
          [isFunctionWithName, term => {
            term.name = removeScope(term.name, self.context.useScope);
            registerBindings(term.name, self.context);
            return Just(term);
          }],
          [isImport, term => {
            let mod = self.context.modules.load(term.moduleSpecifier.val(), self.context);
            // mutates the store
            mod.visit(self.context);
            let boundNames = bindImports(term, mod, self.context);
            // NOTE: self is a hack for MVP modules
            if (boundNames.size === 0) {
              return Just(term);
            }
            return Nothing();
          }],
          [isEOF, Nothing],
          [_.T, Just]
        ]),
        Maybe.maybe(List(), _.identity)
      )();

      result = result.concat(term);
    }
    return result;
  }
}
