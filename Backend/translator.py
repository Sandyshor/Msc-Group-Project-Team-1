import os
import requests

URL = "https://api.cognitive.microsofttranslator.com/translate"


def translate(texts, lang):
    if lang == "en" or not texts:
        return texts
    r = requests.post(
        URL,
        params={"api-version": "3.0", "from": "en", "to": lang},
        headers={
            "Ocp-Apim-Subscription-Key": os.environ["TRANSLATOR_KEY"],
            "Ocp-Apim-Subscription-Region": os.environ["TRANSLATOR_REGION"],
        },
        json=[{"Text": t} for t in texts],
        timeout=10,
    )
    r.raise_for_status()
    return [item["translations"][0]["text"] for item in r.json()]
