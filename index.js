const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const app = express();

// config
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
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

// make and send token

const db = client.db("nova-news");
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const userCollection = db.collection("users");
    const articleCollection = db.collection("articles");
    const publisherCollection = db.collection("publisher");

    app.post("/jwt", (req, res) => {
      const userEmail = req.body;
      const token = jwt.sign({ data: userEmail }, process.env.Token_Secret, {
        expiresIn: "365d",
      });
      res.send({ token });
    });

    // verify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.data.email;

      const result = await userCollection.findOne({ email });
      if (!result || !result?.isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // -------------verify premium expiration date time--------
    const verifyPremium = async (email) => {
      // const email = req.decoded.data.email;
      // const email = req.params.email;

      const user = await userCollection.findOne({ email });

      if (user?.premiumTaken) {
        const currentTime = new Date();
        const expirationTime = new Date(user.premiumTaken);

        if (currentTime > expirationTime) {
          const updateDoc = {
            $set: { premiumTaken: "" },
          };

          await userCollection.updateOne({ email }, updateDoc);
          console.log("use premium time end");
          return { isSubscription: false };
        } else {
          return { isSubscription: true };
        }
      }
      return { isSubscription: false };
    };

    // save users in the db after login and singup
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

    // payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const price = req.body.price;
      const priceInCent = parseFloat(price) * 100;

      if (!price || priceInCent < 1) return;
      const { client_secret } = await stripe.paymentIntents.create({
        amount: priceInCent,
        currency: "usd",
        // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
        automatic_payment_methods: {
          enabled: true,
        },
      });

      res.send({ clientSecret: client_secret });
    });

    // make a user premium
    app.post("/subscription", verifyToken, async (req, res) => {
      const { email, time } = req.body;
      const expirationDate = new Date();

      if (time === 1) {
        expirationDate.setMinutes(expirationDate.getMinutes() + 1);
      } else if (time === 5) {
        expirationDate.setDate(expirationDate.getDate() + 5);
      } else if (time === 10) {
        expirationDate.setDate(expirationDate.getDate() + 10);
      }

      const filter = { email };
      const updateDoc = {
        $set: { premiumTaken: expirationDate.toISOString() },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // ----------- admin related apis ------------

    // get all users
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    // make user admin
    app.patch("/users/:email", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const isAdmin = req.body;

      const filter = { email: email };
      const updateDoc = {
        $set: {
          ...isAdmin,
        },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // is he/she admin
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      res.send(user);
    });

    // get all article from  the db
    app.get("/allArticles", verifyToken, verifyAdmin, async (req, res) => {
      const result = await articleCollection.find().toArray();
      res.send(result);
    });

    // change articles state in the db
    app.patch("/article/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const articleInfo = req.body;
      delete articleInfo.id;

      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          ...articleInfo,
        },
      };
      const result = await articleCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // delete articles in the db
    app.delete("/article/:id", verifyToken, async (req, res) => {
      const id = req.params.id;

      const query = { _id: new ObjectId(id) };
      const result = await articleCollection.deleteOne(query);
      res.send(result);
    });

    // get all publisher
    app.get("/publisher", async (req, res) => {
      const result = await publisherCollection.find().toArray();
      res.send(result);
    });

    // add publisher api
    app.post("/publisher", async (req, res) => {
      const publisher = req.body;
      const result = await publisherCollection.insertOne(publisher);
      res.send(result);
    });

    // --------- users related api -----------

    // topArticle from the db
    app.get("/topArticles", async (req, res) => {
      const result = await articleCollection
        .find({})
        .sort({ viewCount: -1 })
        .limit(6)
        .toArray();
      res.send(result);
    });

    // statics from the db
    app.get("/statistic", async (req, res) => {
      const users = await userCollection.countDocuments({});
      const normalUsers = await userCollection.countDocuments({
        premiumTaken: "",
      });
      const premiumUsers = await userCollection.countDocuments({
        premiumTaken: { $ne: "" },
      });
      res.send({ users, normalUsers, premiumUsers });
    });

    // get all approved article from  the db
    app.get("/articles", async (req, res) => {
      const { title, publisher, tag } = req.query;
      let query = { status: "approved" };
      console.log(req.query);

      if (title) {
        query.title = { $regex: title, $options: "i" };
      }

      if (publisher) {
        query["publisher.value"] = { $regex: publisher, $options: "i" };
      }

      if (tag) {
        query.tags = { $elemMatch: { label: { $regex: tag, $options: "i" } } };
      }

      const result = await articleCollection.find(query).toArray();
      res.send(result);
    });

    // get single article from  the db
    app.get("/article/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const email = req.decoded.data.email;

      // get user Premium state
      const { isSubscription } = await verifyPremium(email);
      console.log(isSubscription);

      // get the article from articles
      const query = { _id: new ObjectId(id) };
      const result = await articleCollection.findOne(query);

      // console.log(result);
      if (isSubscription === true) {
        return res.send(result);
      } else {
        if (result?.isPremium === true) {
          return res.status(404).send({ message: "Only for Premium User" });
        } else {
          res.send(result);
        }
      }
    });

    // get all approved article from  the db
    app.get("/articles/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.data.email) {
        return res.status(401).send({ message: "unauthorized token" });
      }

      const query = { "author.email": email };
      const result = await articleCollection.find(query).toArray();
      res.send(result);
    });

    // get premium articles
    app.get("/premium-articles", async (req, res) => {
      const query = { isPremium: true };
      const result = await articleCollection.find(query).toArray();
      res.send(result);
    });

    // add article in the db
    app.post("/article", verifyToken, async (req, res) => {
      const article = req.body;
      const email = req.decoded.data.email;

      const { isSubscription } = await verifyPremium();

      if (isSubscription === true) {
        const result = await articleCollection.insertOne(article);
        return res.send(result);
      } else {
        const count = await articleCollection.countDocuments({
          "author.email": email,
        });
        if (count > 0) {
          console.log("must be 1");
          return res
            .status(404)
            .send({ message: "Normal user can't post more than 1" });
        } else {
          const result = await articleCollection.insertOne(article);
          return res.send(result);
        }
      }
    });

    // update viewCount article in the db
    app.patch("/articleViewCount/:id", async (req, res) => {
      const id = req.params.id;
      console.log("called");
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $inc: { viewCount: 1 },
      };
      const result = await articleCollection.updateOne(filter, updateDoc);
      if (result.modifiedCount === 0) {
        res.status(404).send("Article not found");
      }
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
