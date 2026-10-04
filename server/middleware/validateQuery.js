module.exports = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success)
    return res.status(400).json({ error: "Invalid query parameters" });
  req.validatedQuery = result.data;
  next();
};
