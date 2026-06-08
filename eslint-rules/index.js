/**
 * Custom ESLint rules for runon
 */
import noSingleLineBlockComment from "./no-single-line-block-comment/rule.js";

export default {
  rules: {
    "no-single-line-block-comment": noSingleLineBlockComment,
  },
};
