const express = require("express");
const router = express.Router();

router.use("/upload", require("./upload"));
router.use("/info", require("./queryInfo"));
router.use("/upload-status",require("./status"));
module.exports = router;
