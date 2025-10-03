// prerender.config.js
import fs from 'fs/promises';

function searchJSON(obj, key, val) {
    let results = [];
    for (let k in obj) {
        if (obj.hasOwnProperty(k)) {
            if (k === key && obj[k].startsWith(val)) {
                results.push(obj[k]);
            } else if (Array.isArray(obj[k])) {
                for(const r of obj[k]) {
                    if(typeof r === "object") results = results.concat(searchJSON(r, key, val));
                }
            } else if (typeof obj[k] === "object") {
            results = results.concat(searchJSON(obj[k], key, val));
            }
        }
    }
    return results
}


export default async function() {
    let tradRoutes = [];
    
    try {
      const data = await JSON.parse(await fs.readFile('./prod/traditions.json', 'utf-8'));
  
      let IDs = []
      for(const k of ["bdr:PR","bdr:MW"]) {
        IDs = IDs.concat(searchJSON(data, "id", k))
      }
  
      //const posts = JSON.parse(postsData);
      //tradRoutes = posts.map(post => `/trad/${post.slug}`);
  
      tradRoutes = IDs.map(i => '/show/'+i) //.filter((id,n) => n < 100)
  
    } catch (error) {
      console.warn('⚠️  Could not load:', error.message);
    }
    
    return {
      routes: [ //."/", 
        ...tradRoutes
      ],
      outDir: "static-pages",
      serveDir: "prod",
      flatOutput: false,
    };
}

/*
export default createConfig // with "()" here it made my computer freeze which crashed my ssd
*/

/*
export default async function() {
  let blogRoutes = [];
  
  try {
    const postsData = await fs.readFile('./src/data/posts.json', 'utf-8');
    const posts = JSON.parse(postsData);
    blogRoutes = posts.map(post => `/blog/${post.slug}`);
  } catch (error) {
    console.warn('⚠️  Could not load blog posts:', error.message);
  }
  
  return {
    routes: ["/", "/blog", ...blogRoutes],
    outDir: "static-pages",
    serveDir: "build"
  };
}
*/

/*
export default {
    routes: ["/"],
    outDir: "static-pages",
    serveDir: "prod",
    flatOutput: false, // Optional: true for about.html, false for about/index.html    
  };
*/
