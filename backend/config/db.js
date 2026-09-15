const mongoose = require("mongoose")
const connectDB = async()=>{
    try {
        await mongoose.connect(
          "mongodb+srv://ayushtiwaricreatorslab_db_user:dP0SFxSONaAITSLh@cluster0.ielhe1l.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
        );
        console.log("Connected to DB!!")
    } catch (error) {
        console.log(error)
    }
}
module.exports = connectDB