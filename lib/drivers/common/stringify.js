// a wrapper around JSON.stringify to allow for more control over the formatting of the JSON

export default function stringify(obj, optionsOptional) {
  const stringOrChar = /("(?:[^\\"]|\\.)*")|[:,]/g;

  function prettify(string) {
    return string.replace(stringOrChar, (match, str) => (str ? match : `${match} `));
  }

  function get(opt, name, defaultValue) {
    return (name in opt ? opt[name] : defaultValue);
  }

  const options = optionsOptional || {};
  const indent = JSON.stringify([1], null, get(options, 'indent', 2)).slice(2, -3);
  const maxLength = (indent === '' ? Infinity : get(options, 'maxLength', 80));
  const maxLevelPretty = get(options, 'maxLevelPretty', Infinity);

  return (function _stringify(objectParam, currentIndent, reserved) {
    let object = objectParam;
    if (object && typeof object.toJSON === 'function') {
      object = object.toJSON();
    }

    const string = JSON.stringify(object);

    if (string === undefined) {
      return string;
    }

    const currentLevel = currentIndent.length / indent.length;
    if (currentLevel >= maxLevelPretty) {
      return string;
    }

    const length = maxLength - currentIndent.length - reserved;

    if (string.length <= length) {
      const prettified = prettify(string);
      if (prettified.length <= length) {
        return prettified;
      }
    }

    if (typeof object === 'object' && object !== null) {
      const nextIndent = currentIndent + indent;
      const items = [];
      let delimiters;
      const comma = (array, index) => (index === array.length - 1 ? 0 : 1);

      if (Array.isArray(object)) {
        for (let index = 0; index < object.length; index++) {
          items.push(_stringify(object[index], nextIndent, comma(object, index)) || 'null');
        }
        delimiters = '[]';
      } else {
        Object.keys(object).forEach((key, index, array) => {
          const keyPart = `${JSON.stringify(key)}: `;
          const value = _stringify(
            object[key], nextIndent,
            keyPart.length + comma(array, index),
          );
          if (value !== undefined) {
            items.push(keyPart + value);
          }
        });
        delimiters = '{}';
      }

      if (items.length > 0) {
        return [
          delimiters[0],
          indent + items.join(`,\n${nextIndent}`),
          delimiters[1],
        ].join(`\n${currentIndent}`);
      }
    }

    return string;
  }(obj, '', 0));
}
