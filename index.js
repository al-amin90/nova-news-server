const { MongoClient, ServerApiVersion } = require("mongodb");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const app = express();

// config
require("dotenv").config();
const port = process.env.PORT || 5000;

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.hjmc0vt.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// middleware
const verifyToken = (req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "unAuthorized user" });
  }

  const token = req.headers.authorization.split(" ")[1];
  jwt.verify(token, process.env.Token_Secret, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(403).send({ message: "forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
};

const db = client.db("nova-news");
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const userCollection = db.collection("users");
    const articleCollection = db.collection("articles");

    // make and send token
    app.post("/jwt", (req, res) => {
      const userEmail = req.body;
      console.log(userEmail);
      const token = jwt.sign({ data: userEmail }, process.env.Token_Secret, {
        expiresIn: "365d",
      });
      res.send({ token });
    });

    // save users
    app.post("/users", async (req, res) => {
      const currentUser = req.body;
      const email = req.body.email;

      const query = { email: email };
      const isLogin = await userCollection.findOne(query);
      if (isLogin?.email) {
        res.send(isLogin);
      } else {
        const result = await userCollection.insertOne(currentUser);
        res.send(result);
      }
    });

    // add article in the db
    app.post("/article", verifyToken, async (req, res) => {
      const article = req.body;
      const result = await articleCollection.insertOne(article);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("novaNews server running perfectly.....");
});

app.listen(port, () => {
  console.log(`the server port is running on ${port}`);
});
