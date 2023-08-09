import needle from 'needle';
import cheerio from 'cheerio';
import { BadRequestError } from '../helpers/errorHandler.js';
import WebsiteTarget from './scrapperModel/scrapperTargetModel.js';
import Result from './scrapperModel/scrapperResults.js';
import Keyword from './scrapperModel/scrapperKeyword.js';

const scrapperLoader = cheerio.load;
const urlAnalyzer = needle;

async function fetchUrl(url) {
  try {
    const response = await urlAnalyzer(url);
    return response.body;
  } catch (error) {
    return error.message;
  }
}

function checkInputContent(url, objectClass) {
  if (!url || !objectClass) {
    throw new BadRequestError('bad request');
  }
}

function scrapeData(bodyHtml, objectClass) {
  const articles = [];
  const scrapeLoad = scrapperLoader(bodyHtml);

  scrapeLoad(objectClass, bodyHtml).each(function () {
    const title = scrapeLoad(this).text();
    const link = scrapeLoad(this).find('a').attr('href');
    articles.push({
      title,
      link,
    });
  });
  return articles;
}

function removeSpecialChars(str) {
  const regex = /[\n\t]+/g;

  return str.replace(regex, '  ');
}

function filterArticles(articles, filterFn) {
  return articles.filter(filterFn);
}

function noKeyword() {
  return function () {
    return true;
  };
}

function withKeyword(keyWord) {
  return function (article) {
    const convertToLowerCase = article.title.toLowerCase();

    return convertToLowerCase.includes(keyWord);
  };
}

function cleanArticles(articles) {
  return articles.map((article) => {
    article.title = removeSpecialChars(article.title);
    return article;
  });
}

async function scrapeAndCleanData(url, cssClass, keyword) {
  // get body
  const bodyHtml = await fetchUrl(url);
  // id articles
  const articles = scrapeData(bodyHtml, cssClass);
  // clean texts
  const cleanedArticles = cleanArticles(articles);
  const filterFn = keyword ? withKeyword(keyword) : noKeyword();
  // search by keyword or
  const filteredArticles = filterArticles(cleanedArticles, filterFn);
  return filteredArticles;
}

async function getOrCreateKeyword(keyword) {
  if (!keyword) {
    return null;
  }
  const [resultKeyword, created] = await Keyword.findOrCreate({
    where: { keyword },
    defaults: { usedTimes: 1 },
  });
  return resultKeyword;
}

async function createWebsiteTarget(url, cssClass) {
  try {
    const websiteTarget = await WebsiteTarget.findOrCreate(
      { url, cssClass },
      { $inc: { scrapedTimes: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    console.log(websiteTarget);
    return websiteTarget;
  } catch (error) {
    throw error;
  }
}

async function createArticles(
  arrayResultsScrapped,
  websiteTarget,
  resultKeyword,
) {
  const results = [];
  try {
    for (const article of arrayResultsScrapped) {
      const result = await Result.findOrCreate({
        websiteTarget: websiteTarget._id,
        title: article.title,
        link: article.link,
      });

      results.push(result);

      if (resultKeyword) {
        if (!result.keywords.includes(resultKeyword)) {
          result.keywords.push(resultKeyword);
          await result.save();
        }
      }
    }
    return results;
  } catch (error) {
    throw error;
  }
}

async function saveScrapedDataToDatabase(req) {
  console.log('saving');
  const url = req.body.url;
  const cssClass = req.body.objectClass;
  const keyword = req.body.keyWord;

  const arrayResultsScrapped = await scrapeAndCleanData(url, cssClass, keyword);
  const websiteTarget = await createWebsiteTarget(url, cssClass);
  const resultKeyword = await getOrCreateKeyword(keyword);
  const saveArticlesToDb = await createArticles(
    arrayResultsScrapped,
    websiteTarget,
    resultKeyword,
  );
  return {
    state: 'success',
    'objects found': arrayResultsScrapped.length,
    'key-word': keyword,
    'scanned webpage': url,
    'found articles': arrayResultsScrapped,
  };
}

const scrappService = {
  checkInputContent,
  fetchUrl,
  scrapeData,
  removeSpecialChars,
  filterArticles,
  noKeyword,
  withKeyword,
  cleanArticles,
  scrapeAndCleanData,
  saveScrapedDataToDatabase,
};

export default scrappService;
