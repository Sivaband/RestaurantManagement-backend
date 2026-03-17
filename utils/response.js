const success = (res, data = {}, message = 'Success', statusCode = 200) =>
  res.status(statusCode).json({ success: true, message, data });

const paginated = (res, data, pagination, message = 'Success') =>
  res.status(200).json({ success: true, message, data, pagination });

const error = (res, message = 'Something went wrong', statusCode = 500, errors = []) =>
  res.status(statusCode).json({ success: false, message, errors });

module.exports = { success, paginated, error };
