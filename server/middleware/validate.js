function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fieldErrors = {};
      const firstErrorMessage = result.error.issues[0]?.message || "Validation failed";

      for (const issue of result.error.issues) {
        const field = issue.path.join(".") || "body";
        if (!fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
      }

      return res.status(400).json({
        error: firstErrorMessage,
        details: fieldErrors,
      });
    }

    req.body = result.data;
    next();
  };
}

module.exports = validate;
