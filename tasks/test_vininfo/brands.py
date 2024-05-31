from test_vininfo.common import Brand
from test_vininfo.details import avtovaz, nissan, opel, renault


class Lada(Brand):

    extractor = avtovaz.AvtoVazDetails


class Nissan(Brand):

    extractor = nissan.NissanDetails


class Opel(Brand):

    extractor = opel.OpelDetails


class Renault(Brand):

    extractor = renault.RenaultDetails
