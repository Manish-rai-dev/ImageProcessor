// server.js

const express = require('express');
const multer = require('multer');
const csvParser = require('csv-parser');
const fs = require('fs');
const mongoose = require('mongoose');
const axios = require('axios');
const sharp = require('sharp');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const upload = multer({ dest: 'uploads/' });
const webhookUrl = process.env.WEBHOOK_URL;

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const RequestSchema = new mongoose.Schema({
    requestId: String,
    status: String,
    products: Array
});

const Request = mongoose.model('Request', RequestSchema);

app.post('/upload', upload.single('file'), async (req, res) => {
    const requestId = new mongoose.Types.ObjectId();
    const products = [];

    fs.createReadStream(req.file.path)
        .pipe(csvParser())
        .on('data', (row) => {
            products.push(row);
        })
        .on('end', async () => {
            const newRequest = new Request({
                requestId: requestId,
                status: 'Processing',
                products: products
            });
            await newRequest.save();

            processImages(requestId, products);
            res.send({ requestId: requestId });
        });
});

app.get('/status/:requestId', async (req, res) => {
    const request = await Request.findOne({ requestId: req.params.requestId });
    if (request) {
        res.send({ status: request.status, products: request.products });
    } else {
        res.status(404).send({ message: 'Request not found' });
    }
});

async function processImages(requestId, products) {
    for (let product of products) {
        const inputUrls = product['Input Image Urls'].split(',');
        const outputUrls = [];

        for (let url of inputUrls) {
            const response = await axios({ url, responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data, 'binary');
            const outputPath = `uploads/output-${Date.now()}.jpg`;

            await sharp(buffer)
                .jpeg({ quality: 50 })
                .toFile(outputPath);

            outputUrls.push(outputPath);
        }

        product['Output Image Urls'] = outputUrls.join(',');
    }

    await Request.updateOne({ requestId }, { $set: { status: 'Completed', products: products } });

    // Trigger webhook
    axios.post(webhookUrl, {
        requestId: requestId,
        status: 'Completed',
        products: products
    }).catch(err => console.error('Webhook error:', err));
}

app.listen(3000, () => {
    console.log('Server started on port 3000');
});
