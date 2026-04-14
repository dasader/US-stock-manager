from unittest.mock import patch, MagicMock
from app.services.gold_price_service import gold_price_service


_SAMPLE_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<response>
  <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
  <body>
    <numOfRows>3</numOfRows>
    <pageNo>1</pageNo>
    <totalCount>3082</totalCount>
    <items>
      <item>
        <srtnCd>04020000</srtnCd>
        <itmsNm>금 99.99_1kg</itmsNm>
        <basDt>20260413</basDt>
        <clpr>226170</clpr>
      </item>
      <item>
        <srtnCd>04020100</srtnCd>
        <itmsNm>미니금 99.99_100g</itmsNm>
        <basDt>20260413</basDt>
        <clpr>226990</clpr>
      </item>
      <item>
        <srtnCd>04020000</srtnCd>
        <itmsNm>금 99.99_1kg</itmsNm>
        <basDt>20260410</basDt>
        <clpr>226700</clpr>
      </item>
    </items>
  </body>
</response>"""


@patch("app.services.gold_price_service.requests.get")
@patch.dict("os.environ", {"datagokr_API_KEY": "fake-key"})
def test_get_price_picks_latest_1kg(mock_get):
    mock_resp = MagicMock(status_code=200, text=_SAMPLE_XML)
    mock_get.return_value = mock_resp
    gold_price_service._cache.clear()
    price = gold_price_service.get_price()
    # 20260413 > 20260410 → 226170
    assert price == 226170.0


@patch("app.services.gold_price_service.requests.get")
@patch.dict("os.environ", {}, clear=True)
def test_get_price_no_key_returns_none(mock_get):
    assert gold_price_service.get_price() is None
    mock_get.assert_not_called()


@patch("app.services.gold_price_service.requests.get")
@patch.dict("os.environ", {"datagokr_API_KEY": "fake-key"})
def test_get_price_non_200(mock_get):
    mock_get.return_value = MagicMock(status_code=500, text="error")
    assert gold_price_service.get_price() is None


@patch("app.services.gold_price_service.requests.get")
@patch.dict("os.environ", {"datagokr_API_KEY": "fake-key"})
def test_get_price_api_error_code(mock_get):
    err_xml = "<response><header><resultCode>30</resultCode></header></response>"
    mock_get.return_value = MagicMock(status_code=200, text=err_xml)
    assert gold_price_service.get_price() is None
