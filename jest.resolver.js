// Default Jest resolution uses the CommonJS ("require") export condition. A few
// deps (notably @workos-inc/authkit-nextjs) publish an ESM-only `exports` map
// with just an `import` condition, so a plain resolve throws. Retry those with
// the `import` condition instead of forcing it globally (which would break
// packages such as `dedent` that ship both).
module.exports = (request, options) => {
  try {
    return options.defaultResolver(request, options);
  } catch (error) {
    return options.defaultResolver(request, {
      ...options,
      conditions: [...(options.conditions || []), "import"],
    });
  }
};
